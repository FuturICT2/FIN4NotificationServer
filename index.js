const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { ethers } = require('ethers');
const port = 5000;
const config = require('./config.json');

// const rinkebyProvider = new ethers.providers.InfuraProvider("rinkeby", config.INFURA_API_KEY)
const provider = new ethers.providers.JsonRpcProvider('http://localhost:7545');

const Fin4Main = {
	json: require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Main.json'),
	address: config.FIN4MAIN_ADDRESS
};

let Fin4MainContract = new ethers.Contract(Fin4Main.address, Fin4Main.json.abi, provider);

Fin4MainContract.getSatelliteAddresses().then(addresses => {
	// 2 Fin4TokenManagement
	let Fin4TokenManagementContract = new ethers.Contract(addresses[2],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4TokenManagement.json').abi, provider
	);
	Fin4TokenManagementContract.on('Fin4TokenCreated', (...args) => {
		let values = args.pop().args;
		console.log('Received Fin4TokenCreated Event from Fin4TokenManagement contract', values);
		io.emit('Fin4TokenCreated', values);
	});

	// 3 Fin4Claiming
	let Fin4ClaimingContract = new ethers.Contract(addresses[3],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Claiming.json').abi, provider
	);
	Fin4ClaimingContract.on('ClaimSubmitted', (...args) => {
		let values = args.pop().args;
		console.log('Received ClaimSubmitted Event from Fin4Claiming contract', values);
		emitOnSocket(values.claimer, 'ClaimSubmitted', values)
	});
	Fin4ClaimingContract.on('ClaimApproved', (...args) => {
		let values = args.pop().args;
		console.log('Received ClaimApproved Event from Fin4Claiming contract', values);
		emitOnSocket(values.claimer, 'ClaimApproved', values)
	});
	Fin4ClaimingContract.on('ClaimRejected', (...args) => {
		let values = args.pop().args;
		console.log('Received ClaimRejected Event from Fin4Claiming contract', values);
		emitOnSocket(values.claimer, 'ClaimRejected', values)
	});
	Fin4ClaimingContract.on('VerifierPending', (...args) => {
		let values = args.pop().args;
		console.log('Received VerifierPending Event from Fin4Claiming contract', values);
		emitOnSocket(values.claimer, 'VerifierPending', values)
	});
	Fin4ClaimingContract.on('VerifierApproved', (...args) => {
		let values = args.pop().args;
		console.log('Received VerifierApproved Event from Fin4Claiming contract', values);
		emitOnSocket(values.claimer, 'VerifierApproved', values)
	});
	Fin4ClaimingContract.on('VerifierRejected', (...args) => {
		let values = args.pop().args;
		console.log('Received VerifierRejected Event from Fin4Claiming contract', values);
		emitOnSocket(values.claimer, 'VerifierRejected', values)
	});
	Fin4ClaimingContract.on('UpdatedTotalSupply', (...args) => {
		let values = args.pop().args;
		console.log('Received UpdatedTotalSupply Event from Fin4Claiming contract', values);
		io.emit('UpdatedTotalSupply', values);
	});

	// 5 Fin4Messaging
	let Fin4MessagingContract = new ethers.Contract(addresses[5],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Messaging.json').abi, provider
	);
	Fin4MessagingContract.on('NewMessage', (...args) => {
		let values = args.pop().args;
		console.log('Received NewMessage Event from Fin4Messaging contract', values);
		emitOnSocket(values.receiver, 'NewMessage', values)
	});
	Fin4MessagingContract.on('MessageMarkedAsRead', (...args) => {
		let values = args.pop().args;
		console.log('Received MessageMarkedAsRead Event from Fin4Messaging contract', values);
		emitOnSocket(values.receiver, 'MessageMarkedAsRead', values)
	});

	// 6 Fin4Verifying
	let Fin4VerifyingContract = new ethers.Contract(addresses[6],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Verifying.json').abi, provider
	);
	Fin4VerifyingContract.on('SubmissionAdded', (...args) => {
		let values = args.pop().args;
		console.log('Received SubmissionAdded Event from Fin4Verifying contract', values);
		io.emit('SubmissionAdded', values);
	});
});

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

	socket.on('disconnect', () => {
		console.log('UNREGISTERED ethAddress: ' + socketIdToEthAddress[socket.id], ' socketId: ', socket.id);
		delete ethAddressToSocketId[socketIdToEthAddress[socket.id]];
		delete socketIdToEthAddress[socket.id];
		console.log('Total registered: ' + Object.keys(ethAddressToSocketId).length);
	});
});

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

http.listen(port, () => {
	console.log('listening on port: ', port);
});
