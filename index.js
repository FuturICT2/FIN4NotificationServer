const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { ethers } = require('ethers');
const port = 5000;
const config = require('./config.json');
const Telegraf = require('telegraf')
const extra = require('telegraf/extra');
const markup = extra.markdown();

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
		audience: 'all',
		sendAsMessage: true
	},
	ClaimSubmitted: {
		contractName: 'Fin4Claiming',
		audience: 'claimer',
		sendAsMessage: false
	},
	ClaimApproved: {
		contractName: 'Fin4Claiming',
		audience: 'claimer',
		sendAsMessage: true
	},
	ClaimRejected: {
		contractName: 'Fin4Claiming',
		audience: 'claimer',
		sendAsMessage: true
	},
	UpdatedTotalSupply: {
		contractName: 'Fin4Claiming',
		audience: 'claimer',
		sendAsMessage: false
	},
	VerifierPending: {
		contractName: 'Fin4Claiming',
		audience: 'claimer',
		sendAsMessage: false
	},
	VerifierApproved: {
		contractName: 'Fin4Claiming',
		audience: 'claimer',
		sendAsMessage: true
	},
	VerifierRejected: {
		contractName: 'Fin4Claiming',
		audience: 'claimer',
		sendAsMessage: true
	},
	NewMessage: {
		contractName: 'Fin4Messaging',
		audience: 'receiver',
		sendAsMessage: true
	},
	MessageMarkedAsRead: {
		contractName: 'Fin4Messaging',
		audience: 'receiver',
		sendAsMessage: false
	},
	SubmissionAdded: {
		contractName: 'Fin4Verifying',
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
			let values = extractValues(contractName, args);
			console.log('Received ' + eventName + ' Event from ' + contractName + ' contract', values);
			
			// TODO add barrier to avoid sending events from before starting this server
			// a blocked time at the beginning maybe?

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
	io.emit(eventName, values);
	if (contractEvents[eventName].sendAsMessage) {
		buildMessage(eventName, values, true, message => {
			Object.keys(activeTelegramUsers).map(telegramUser => bot.telegram.sendMessage(telegramUser, message, markup));
		});
	}
};

const sendToUser = (ethAddress, eventName, values) => {
	emitOnSocket(ethAddress, eventName, values);
	let telegramUser = ethAddressToTelegramUser[ethAddress];
	if (telegramUser && contractEvents[eventName].sendAsMessage) {
		buildMessage(eventName, values, false, message => {
			bot.telegram.sendMessage(telegramUser, message, markup);
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

const formatToken = obj => {
	return '`[' + obj.symbol + '] ' + obj.name + '`';
};

const tokenInfos = {};
const verifierInfos = {};

const buildMessage = (eventName, values, toAll, callback) => {
	// let intro = 'A message from the ' + values.contractName + ' contract to ' + (toAll ? 'all' : 'you') + ':\n';
	let message = '';
	let text;
	switch(eventName) {
		case 'Fin4TokenCreated':
			let descriptionParts = values.description.split('||');
			message = 'New token created:\n' + formatToken(values);
			if (descriptionParts.length > 1 && descriptionParts[0]) {
				message += '\n' + descriptionParts[0];
			}
			callback(message);
			break;
		case 'ClaimApproved':
		case 'ClaimRejected':
			text = () => {
				let tokenInfo = tokenInfos[values.tokenAddr];
				if (eventName === 'ClaimApproved') {
					return 'Your claim of `' + values.mintedQuantity + '` on token ' + formatToken(tokenInfo)
						+ ' was successful, your new balance on this token is `' + values.newBalance + '`';
				}
				if (eventName === 'ClaimRejected') {
					return 'Your claim  on token ' + formatToken(tokenInfo) + ' got rejected';
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
				message = 'The verifier `'  + verifierInfo.contractName + '` ' + (eventName === 'VerifierApproved' ? 'approved' : 'rejected')
					+ ' the provided proof for your claim on token ' + formatToken(tokenInfo);
				if (values.message) {
					message += '\nAttached message: _' + values.message + '_';
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

io.on('connection', socket => {
	console.log('user connected');

	socket.on('register', ethAddress => {
		ethAddressToSocketId[ethAddress] = socket.id;
		socketIdToEthAddress[socket.id] = ethAddress;
		console.log('REGISTERED ethAddress: ' + ethAddress, ' socketId: ', socket.id);
		console.log('Total registered: ' + Object.keys(ethAddressToSocketId).length);
	});

	socket.on('message', msg => {
		console.log('message: ' + msg);
	});

	socket.on('email-signup', msg => {
		emailSignup(msg);
	});

	socket.on('disconnect', () => {
		console.log('UNREGISTERED ethAddress: ' + socketIdToEthAddress[socket.id], ' socketId: ', socket.id);
		delete ethAddressToSocketId[socketIdToEthAddress[socket.id]];
		delete socketIdToEthAddress[socket.id];
		console.log('Total registered: ' + Object.keys(ethAddressToSocketId).length);
	});
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
		ethAddress: null
	};
	console.log('Telegram user ' + id + ' has connected');
	ctx.reply('Welcome to the *FIN4Notifications bot*! From now on you will receive notifications when a new token is created. If you also want notifications concerning your account (claim approval etc.), please share your public Ethereum address in the format ```\nmy-address 0x...\n```Note that you thereby allow a link to be made between your Telegram Id and your Ethereum address. That info lives only in the database of the notification server, but servers can be hacked.', markup);
	ctx.reply('For transparency, this is the info I am seeing from you:```\n' + JSON.stringify(ctx.chat) + '```\nI stored only the Id from it', markup);
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
	ctx.reply('You are now unsubscribed from all contract events');
});

bot.on('message', ctx => {
	let id = ctx.chat.id;
	if (!activeTelegramUsers[id]) {
		ctx.reply('Ups, I don\'t think I know you yet, please run the /start command first');
		return;
	}
	let text = ctx.message.text;
	console.log('Received telegram message from ' + id + ': ' + text);
	if (!(text.startsWith('my-address') && text.split(' ').length > 1)) {
		ctx.reply('Hey, nice of you to talk to me. That\'s not something I know how to respond to though, sorry');
	}
	let ethAddress = text.split(' ')[1];
	if (!isValidAddress(ethAddress)) {
		ctx.reply('Sorry, that is an invalid public address');
		return;
	}
	activeTelegramUsers[id].ethAddress = ethAddress;
	ethAddressToTelegramUser[ethAddress] = id;
	ctx.reply('Great, I stored the linkage between your telegram id `' + id + '` and your Ethereum public address `' + ethAddress + '` and will make sure to forward you contract events that are meant for this address', markup);
	console.log('Stored linkage of telegram id ' + id + ' with eth address ' + ethAddress);
});

bot.launch();

// ------------------------ EMAIL ------------------------

const emailSignup = msg => {
	console.log(msg);
};

// ------------------------ SERVE HTML ------------------------

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

// ------------------------ START SERVER ------------------------

http.listen(port, () => {
	console.log('listening on port: ', port);
});
