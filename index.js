const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { ethers } = require('ethers');
const port = 5000;
const config = require('./config.json');
const Telegraf = require('telegraf')
const extra = require('telegraf/extra');
const markup = extra.markdown();
const { nanoid } = require('nanoid');
const ses = require('node-ses'); 
const client = ses.createClient({
	key: config.AWS_SES.KEY,
	secret: config.AWS_SES.SECRET,
	amazon: config.AWS_SES.REGION
});
const MongoClient = require('mongodb').MongoClient;
const dbUrl = 'mongodb://localhost:27017';
const dbName = 'notification-server';
const dbClient = new MongoClient(dbUrl, { useUnifiedTopology: true });

dbClient.connect(err => {
	if (err) {
		console.log("Error:", err);
		return;
	}
	console.log("Connected successfully to mongodb");
	const db = dbClient.db(dbName);
	dbClient.close();
});

const serverLaunchTime = Date.now();
const blockedTimeAfterLaunch = 5; // seconds
// when subscribing with ethers.js, sometimes contract events from BEFORE subscribing are
// fired immediately, the initial block-period is to avoid sending out notifications for these
const inBlockedPhase = () => {
	return (Date.now() - serverLaunchTime) / 1000 < blockedTimeAfterLaunch;
};

const specialChars = {
	telegram: {
		newLine: '\n',
		codeStart: '`',
		codeEnd: '`',
		italicStart: '_',
		italicEnd: '_'
	},
	email: {
		newLine: '<br>',
		codeStart: '<i>',
		codeEnd: '</i>',
		italicStart: '<i>',
		italicEnd: '</i>'
	}
};

// ------------------------ CONTRACT EVENT SUBSCRIPTIONS ------------------------

let provider;
if (config.INFURA_API_KEY) {
	provider = new ethers.providers.InfuraProvider('rinkeby', config.INFURA_API_KEY);
} else {
	provider = new ethers.providers.JsonRpcProvider('http://localhost:7545');
}

let contracts = {
	Fin4MainContract: new ethers.Contract(config.FIN4MAIN_ADDRESS, 
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Main.json').abi, provider)
};

let contractEvents = {
	Fin4TokenCreated: {
		contractName: 'Fin4TokenManagement',
		title: 'New token created',
		audience: 'all',
		sendAsMessage: true
	},
	ClaimSubmitted: {
		contractName: 'Fin4Claiming',
		title: 'Claim submitted',
		audience: 'claimer',
		sendAsMessage: false
	},
	ClaimApproved: {
		contractName: 'Fin4Claiming',
		title: 'Claim approved',
		audience: 'claimer',
		sendAsMessage: true
	},
	ClaimRejected: {
		contractName: 'Fin4Claiming',
		title: 'Claim rejected',
		audience: 'claimer',
		sendAsMessage: true
	},
	UpdatedTotalSupply: {
		contractName: 'Fin4Claiming',
		title: 'Updated total supply',
		audience: 'claimer',
		sendAsMessage: false
	},
	VerifierPending: {
		contractName: 'Fin4Claiming',
		title: 'Verifier pending',
		audience: 'claimer',
		sendAsMessage: false
	},
	VerifierApproved: {
		contractName: 'Fin4Claiming',
		title: 'Verifier approved',
		audience: 'claimer',
		sendAsMessage: true
	},
	VerifierRejected: {
		contractName: 'Fin4Claiming',
		title: 'Verifier rejected',
		audience: 'claimer',
		sendAsMessage: true
	},
	NewMessage: {
		contractName: 'Fin4Messaging',
		title: 'New message',
		audience: 'receiver',
		sendAsMessage: true
	},
	MessageMarkedAsRead: {
		contractName: 'Fin4Messaging',
		title: 'Message marked as read',
		audience: 'receiver',
		sendAsMessage: false
	},
	SubmissionAdded: {
		contractName: 'Fin4Verifying',
		title: 'Submission added',
		audience: 'all',
		sendAsMessage: false
	}
};

contracts.Fin4MainContract.getSatelliteAddresses().then(addresses => {
	// 2 Fin4TokenManagement
	contracts.Fin4TokenManagement = new ethers.Contract(addresses[2],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4TokenManagement.json').abi, provider
	);
	// 3 Fin4Claiming
	contracts.Fin4Claiming = new ethers.Contract(addresses[3],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Claiming.json').abi, provider
	);
	// 5 Fin4Messaging
	contracts.Fin4Messaging = new ethers.Contract(addresses[5],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Messaging.json').abi, provider
	);
	// 6 Fin4Verifying
	contracts.Fin4Verifying = new ethers.Contract(addresses[6],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Verifying.json').abi, provider
	);	

	Object.keys(contractEvents).map(eventName => {
		let contractName = contractEvents[eventName].contractName;
		let audience = contractEvents[eventName].audience;
		contracts[contractName].on(eventName, (...args) => {
			if (inBlockedPhase()) {
				return;
			}

			let values = extractValues(contractName, args);
			console.log('Received ' + eventName + ' Event from ' + contractName + ' contract', values);

			if (audience === 'all') {
				sendToAll(eventName, values);
			} else {
				sendToUser(values[audience], eventName, values)
			}
		});
	});
});

// ------------------------ HELPER METHODS ------------------------

const extractValues = (contractName, args) => {
	/*
	Rearranging the contract event data like this seems necessary
	because it arrives as a mix of array and object:

	0: 0x...
	1: 1
	tokenAddr: 0x...
	claimId: 1

	When I sent this to the frontend or use JSON.stringify(), it keeps
	only the array-part and the keys are lost. I want to pass them though.
	*/
	let raw = args.pop().args;
	let values = {};
	Object.keys(raw).map(key => {
		if (isNaN(key)) { // keep it only if the key is not a number
			let value = raw[key];
			if (value._isBigNumber) {
				value = value.toString();
			}
			values[key] = value;
		}
	});
	values['contractName'] = contractName;
	return values;
};

const isValidAddress = addr => {
	try {
		ethers.utils.getAddress(addr);
	} catch (e) { return false; }
	return true;
};

const sendToAll = (eventName, values) => {
	// io.emit(eventName, values);

	let eventObj = contractEvents[eventName];
	if (!eventObj.sendAsMessage) {
		return;
	}

	buildTelegramMessage(eventName, values, message => {
		Object.keys(activeTelegramUsers).map(telegramUser => bot.telegram.sendMessage(telegramUser, message, markup));
	});

	buildEmailMessage(eventName, values, message => {
		Object.keys(emailSubscribers)
			.map(email => emailSubscribers[email])
			.filter(user => user.events[eventName]) // only users who subscribed to this event type
			.map(user => sendEmail(user.email, eventObj.title, message));
	});
};

const sendToUser = (ethAddress, eventName, values) => {
	// emitOnSocket(ethAddress, eventName, values);

	let eventObj = contractEvents[eventName];
	if (!eventObj.sendAsMessage) {
		return;
	}

	let telegramUser = ethAddressToTelegramUser[ethAddress];
	if (telegramUser) {
		buildTelegramMessage(eventName, values, message => {
			bot.telegram.sendMessage(telegramUser, message, markup);
		});
	}

	let emailUser = ethAddressToEmail[ethAddress];
	let sendByEmail = emailUser && emailSubscribers[emailUser].events[eventName];

	if (emailUser && sendByEmail) {
		buildEmailMessage(eventName, values, message => {
			sendEmail(emailUser, eventObj.title, message)
		});
	}
};

const fetchTokenInfo = (tokenAddr, done) => {
	if (tokenInfos[tokenAddr]) {
		done();
		return;
	}
	contracts.Fin4TokenManagement.getTokenInfo(tokenAddr).then(({ 1: name, 2: symbol }) => {
		tokenInfos[tokenAddr] = {
			name: name,
			symbol: symbol
		};
		done();
	});
};

const fetchVerifierInfo = (verifierAddr, done) => {
	if (verifierInfos[verifierAddr]) {
		done();
		return;
	}
	contracts.Fin4Verifying.getVerifierTypeInfo(verifierAddr).then(({ 0: contractName }) => { // TODO use 1: nameTransKey
		verifierInfos[verifierAddr] = {
			contractName: contractName
		};
		done();
	});
};

const formatToken = (obj, chars) => {
	return chars.codeStart + '[' + obj.symbol + '] ' + obj.name + chars.codeEnd;
};

const tokenInfos = {};
const verifierInfos = {};

const buildTelegramMessage = (eventName, values, callback) => {
	return buildMessage(eventName, values, callback, specialChars.telegram);
};

const buildEmailMessage = (eventName, values, callback) => {
	return buildMessage(eventName, values, callback, specialChars.email);
};

const buildMessage = (eventName, values, callback, chars) => {
	// let intro = 'A message from the ' + values.contractName + ' contract to ' + (toAll ? 'all' : 'you') + ':\n';
	let message = '';
	let text;
	switch(eventName) {
		case 'Fin4TokenCreated':
			let descriptionParts = values.description.split('||');
			message = 'New token created:' + chars.newLine + formatToken(values, chars);
			if (descriptionParts.length > 1 && descriptionParts[0]) {
				message += chars.newLine + descriptionParts[0];
			}
			callback(message);
			break;
		case 'ClaimApproved':
		case 'ClaimRejected':
			text = () => {
				let tokenInfo = tokenInfos[values.tokenAddr];
				if (eventName === 'ClaimApproved') {
					return 'Your claim of ' + chars.codeStart + values.mintedQuantity + chars.codeEnd + ' on token ' + formatToken(tokenInfo, chars)
						+ ' was successful, your new balance on this token is ' + chars.codeStart + values.newBalance + chars.codeEnd;
				}
				if (eventName === 'ClaimRejected') {
					return 'Your claim  on token ' + formatToken(tokenInfo, chars) + ' got rejected';
				}
			};
			fetchTokenInfo(values.tokenAddr, () => {
				callback(text());
			});
			break;
		case 'VerifierApproved':
		case 'VerifierRejected':
			text = () => {
				let tokenInfo = tokenInfos[values.tokenAddrToReceiveVerifierNotice];
				let verifierInfo = verifierInfos[values.verifierTypeAddress];
				message = 'The verifier ' + chars.codeStart  + verifierInfo.contractName + chars.codeEnd + (eventName === 'VerifierApproved' ? ' approved' : ' rejected')
					+ ' the provided proof for your claim on token ' + formatToken(tokenInfo, chars);
				if (values.message) {
					message += chars.newLine + 'Attached message: ' + chars.italicStart + values.message + chars.italicEnd;
				}
				return message;
			};
			fetchTokenInfo(values.tokenAddrToReceiveVerifierNotice, () => {
				fetchVerifierInfo(values.verifierTypeAddress, () => {
					callback(text());
				});
			});
			break;
		case 'NewMessage':
			callback('You received a new message');
			break;
	}
};

// ------------------------ SOCKET ------------------------
/*
const emitOnSocket = (ethAddr, type, values) => {
	let socket = getSocket(ethAddr);
	if (socket) {
		socket.emit(type, values);
	}
};

const getSocket = ethAddr => {
	let socketId = ethAddressToSocketId[ethAddr];
	if (socketId && io.sockets.sockets[socketId]) {
		return io.sockets.sockets[socketId];
	}
	return null;
};

// active frontends
let ethAddressToSocketId = {};
let socketIdToEthAddress = {};
*/
io.on('connection', socket => {
	console.log('New socket connection');

	socket.on('get-fin4-url', () => {
		socket.emit('get-fin4-url-result', config.FIN4_URL);
	});

	socket.on('email-signup', msg => {
		socket.emit('email-signup-result', emailSignup(msg));
	});

	socket.on('check-email-auth-key', authKey => {
		socket.emit('check-email-auth-key-result', checkEmailAuthkey(authKey));
	});

	socket.on('unsubscribe-email', authKey => {
		socket.emit('unsubscribe-email-result', unsubscribeEmail(authKey));
	});

	/*socket.on('register', ethAddress => {
		ethAddressToSocketId[ethAddress] = socket.id;
		socketIdToEthAddress[socket.id] = ethAddress;
		console.log('REGISTERED ethAddress: ' + ethAddress, ' socketId: ', socket.id);
		console.log('Total registered: ' + Object.keys(ethAddressToSocketId).length);
	});
	socket.on('disconnect', () => {
		console.log('UNREGISTERED ethAddress: ' + socketIdToEthAddress[socket.id], ' socketId: ', socket.id);
		delete ethAddressToSocketId[socketIdToEthAddress[socket.id]];
		delete socketIdToEthAddress[socket.id];
		console.log('Total registered: ' + Object.keys(ethAddressToSocketId).length);
	});*/
});

// ------------------------ TELEGRAM BOT ------------------------

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

let activeTelegramUsers = {};
let ethAddressToTelegramUser = {};

bot.command('start', ctx => {
	let id = ctx.chat.id;
	if (activeTelegramUsers[id]) {
		ctx.reply('Oha, it seems I already knew you, please run /stop first if you want to restart');
		return;
	}
	activeTelegramUsers[id] = {
		ethAddress: null,
		events: {
			Fin4TokenCreated: true,
			ClaimApproved: false,
			ClaimRejected: false,
			VerifierApproved: false,
			VerifierRejected: false,
			NewMessage: false
		}
	};
	console.log('Telegram user ' + id + ' has connected');
	ctx.reply('Welcome to the *FIN4Notifications bot*!\n\nFrom now on you will receive notifications about general events, like the creation of a new token. '
		+ 'If you also want notifications concerning your account (claim approval etc.), you have to share your public Ethereum address in the format '
		+ '```\nmy-address 0x...\n```Note that you thereby allow a link to be made between your Telegram Id and your Ethereum address. That info lives '
		+ 'only in the database of the notification server, but servers can be hacked.'
		+ '\nMore info on what this means on the site to subscribe by email:\n' + config.THIS_URL
		+ '\n\nUse the /help command to see your subscription status and get more infos.'
		+ '\nThe /change command describes how to change your subscription.'
		+ '\nWith /stop you unsubscribe from all subscriptions.'
		+ '\n\nFor transparency, this is the info I am seeing from you:```\n' + JSON.stringify(ctx.chat)
		+ '```\nI stored only the `id` from it.', markup);
});

// enable this command via the BotFather on
bot.command('stop', ctx => {
	let id = ctx.chat.id;
	if (!activeTelegramUsers[id]) {
		ctx.reply('Ups, I don\'t think I know you yet, please run the /start command first');
		return;
	}
	let ethAddress = activeTelegramUsers[id].ethAddress;
	if (ethAddress) {
		delete ethAddressToTelegramUser[ethAddress];
		console.log('Removed linkage of telegram id ' + id + ' with eth address ' + ethAddress);
	}
	delete activeTelegramUsers[id];
	console.log('Telegram user id ' + id + ' has disconnected')
	ctx.reply('You are now unsubscribed from all contract events.');
});

bot.command('help', ctx => {
	let id = ctx.chat.id;
	let telegramUser = activeTelegramUsers[id]; 
	let msg = '*Hi, this is the status of your subscription*:\n'
		+ '\n- Your Id: ' + id;
	if (telegramUser) {
		msg += '\n- Your subscription is active'
		let ethAddress = telegramUser.ethAddress;
		if (ethAddress) {
			msg += '\n- Your Ethereum public address:\n    `' + ethAddress + '`';
		} else {
			msg += '\n- I don\'t know your Ethereum public address';
		}
		msg += '\n- You are subscribed to these contract events:';

		let subscribedEvents = Object.keys(telegramUser.events).filter(eventName => telegramUser.events[eventName]);
		if (subscribedEvents.length === 0) {
			msg += ' _none_';
		}
		subscribedEvents.map(eventName => {
			msg += '\n    - _' + contractEvents[eventName].title + '_';
		});

		msg += '\n\nTo change which contract events you want to be notified about, use the \change command.'
			+ '\nTo unsubscribe from all contract events, use the \stop command.';
	} else {
		msg += '\n- You are not subscribed to any contract events'
			+ '\n\nClick /start to get going.';
	}
	ctx.reply(msg, markup);
});

bot.command('change', ctx => {
	let id = ctx.chat.id;
	if (!activeTelegramUsers[id]) {
		ctx.reply('Ups, I don\'t think I know you yet, please run the /start command first');
		return;
	}
	let msg = 'Alright, let\'s change which contract events you will be notified about.'
		+ ' Use the /help command to see which ones you are currently subscribed to.'
		+ '\n\nThese are the available general contract events:';
	let index = 1;
	Object.keys(contractEvents).filter(eventName => contractEvents[eventName].sendAsMessage && contractEvents[eventName].audience === 'all').map(eventName => {
		msg += '\n    *' + index + '*: _' + contractEvents[eventName].title + '_';
		index += 1;
	});
	msg += '\nThese are the available account-specific contract events:';
	Object.keys(contractEvents).filter(eventName => contractEvents[eventName].sendAsMessage && contractEvents[eventName].audience !== 'all').map(eventName => {
		msg += '\n    *' + index + '*: _' + contractEvents[eventName].title + '_';
		index += 1;
	});
	msg += '\n\nWrite me `events` followed by the contract events you want to be subscribed to.';
	msg += ' For instance:\n`events 1,2,3,6`\nmeans, that you want to hear about all but the verifier events.'
	msg += '\nNote that I can\'t subscribe you to any account-specific contract events if I don\'t know your Ethereum public address.'
	ctx.reply(msg, markup);
});

bot.on('message', ctx => { // link ethAddress
	let id = ctx.chat.id;
	if (!activeTelegramUsers[id]) {
		ctx.reply('Ups, I don\'t think I know you yet, please run the /start command first.');
		return;
	}
	let text = ctx.message.text;
	console.log('Received telegram message from ' + id + ': ' + text);

	let keyword = text.split(' ')[0];
	if (!(keyword === 'my-address' || keyword === 'events') || text.split(' ').length !== 2) {
		ctx.reply('Hey, nice of you to talk to me. That\'s not something I know how to respond to though, sorry.');
	}

	if (keyword === 'my-address') {
		let ethAddress = text.split(' ')[1];
		if (!isValidAddress(ethAddress)) {
			ctx.reply('Sorry, that is an invalid public address.');
			return;
		}
		activeTelegramUsers[id].ethAddress = ethAddress;
		activeTelegramUsers[id].events.ClaimApproved = true;
		activeTelegramUsers[id].events.ClaimRejected = true;
		activeTelegramUsers[id].events.VerifierApproved = true;
		activeTelegramUsers[id].events.VerifierRejected = true;
		activeTelegramUsers[id].events.NewMessage = true;
		
		ethAddressToTelegramUser[ethAddress] = id;
		ctx.reply('Great, I stored the linkage between your telegram id `' + id + '` and your Ethereum public address `' + ethAddress + '` and will make sure to forward you contract events that are meant for this address.', markup);
		console.log('Stored linkage of telegram id ' + id + ' with eth address ' + ethAddress);
	}

	if (keyword === 'events') {
		let eventIndicesRaw = text.split(' ')[1].split(',');
		let allSendableEvents = Object.keys(contractEvents).filter(eventName => contractEvents[eventName].sendAsMessage);
		let allSendableGeneralEvents = allSendableEvents.filter(eventName => contractEvents[eventName].audience === 'all');

		let eventIndices = [];

		// validate the indices
		for (let i = 0; i < eventIndicesRaw.length; i++) {
			let index = Number(eventIndicesRaw[i].trim()) - 1;
			if (index < 0 || index >= allSendableEvents.length) {
				ctx.reply('There is an error in your event indices, no change was made. I am expecting numbers ranging from `1` to `' + allSendableEvents.length + '`.', markup);
				return;
			}
			eventIndices.push(index); // no need to check for duplicates, they don't hurt
		}

		allSendableEvents.map((eventName, idx) => {
			let verdict = eventIndices.includes(idx);
			if (!activeTelegramUsers[id].ethAddress && !allSendableGeneralEvents.includes(eventName)) {
				verdict = false;
			}
			activeTelegramUsers[id].events[eventName] = verdict;
		});

		ctx.reply('That worked, your subscription is changed. Use /help to see your new status.', markup);
		console.log('Telegram user ' + id + ' changed their subscription');
	}
});

bot.launch();

// ------------------------ EMAIL ------------------------

// or do one object instead and search more?
let emailSubscribers = {};
let authKeyToEmail = {};
let ethAddressToEmail = {};

const emailSignup = msg => {
	let email = msg.email;
	let ethAddress = msg.ethAddress;
	let events = msg.events;

	if (emailSubscribers[email]) {
		let message = 'You are already subscribed with that email address. If you wish to change your'
		+ ' subscription, please un- and resubscribe.';
		sendEmail(email, 'Already subscribed', message);
		console.log(email + ' is already subscribed');
		return message + ' An email with the link to unsubscribe has been sent to you.';
	}

	if (ethAddress && !isValidAddress(ethAddress)) {
		return 'Sorry, that is an invalid public address';
	}

	let newAuthKey = nanoid(10);
	emailSubscribers[email] = {
		email: email,
		ethAddress: ethAddress,
		authKey: newAuthKey,
		events: events
	};
	authKeyToEmail[newAuthKey] = email;
	if (ethAddress) {
		ethAddressToEmail[ethAddress] = email;
	}

	let subscribedEvents = Object.keys(events).filter(eventName => events[eventName]);
	let message = 'You signed up to receive notifications from the FIN4Xplorer plattform via ' + email + '.'
		+ '<br>You are subscribed to the these events: <i>';
	for (let i = 0; i < subscribedEvents.length; i++) {
		message += contractEvents[subscribedEvents[i]].title + ', ';
	}
	message = message.substring(0, message.length - 2) + '</i>.';

	sendEmail(email, 'Subscription confirmed', message);
	console.log('Subscribed ' + email + ' to notifications');
	return message + '<br>A confirmation email has been sent to you.';
};

const checkEmailAuthkey = authKey => {
	let email = authKeyToEmail[authKey];
	if (email) { // also check if emailSubscribers[email]? It would have to be true too though, or not in particular cases?
		return {
			authKey: authKey,
			email: email
		}
	}
	return null;
};

const unsubscribeEmail = authKey => {
	let email = authKeyToEmail[authKey];
	if (email) {
		delete authKeyToEmail[authKey];
		let ethAddress = emailSubscribers[email].ethAddress;
		if (ethAddress) {
			delete ethAddressToEmail[ethAddress];
		}
		delete emailSubscribers[email];
		console.log('Unsubscribed ' + email + ' from notifications');
		return 'Sucessfully unsubscribed <i>' + email + '</i>';
	}
	return 'Failed to unsubscribe';
};

const sendEmail = (to, subject, message) => {
	let unsubscribeFooter = 'You can unsubscribe from FIN4Xplorer notifications using <a href="' + config.THIS_URL
		+ '/unsubscribe/?authKey=' + emailSubscribers[to].authKey + '">this link</a>.';
	client.sendEmail({
		to: to,
		from: 'finfour@gmx.net',
		cc: '',
		bcc: '',
		subject: '[FIN4Xplorer Notification] ' + subject,
		message: message + '<br><br>' + unsubscribeFooter,
		altText: 'plain text'
	}, (err, data, res) => {
		if (err) {
			console.log('Error sending email', err);
		}
		// console.log('Email sent', data);
	 });
};

// ------------------------ SERVE HTML ------------------------

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

app.get('/unsubscribe', (req, res) => {
	res.sendFile(__dirname + '/unsubscribe.html');
});

// ------------------------ START SERVER ------------------------

http.listen(port, () => {
	console.log('listening on port: ', port);
});
