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
	let Fin4TokenManagementContract = new ethers.Contract(
		addresses[2],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4TokenManagement.json').abi,
		provider
	);

	// 3 Fin4Messaging
	let Fin4MessagingContract = new ethers.Contract(
		addresses[3],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Messaging.json').abi,
		provider
	);

	// 4 Fin4Claiming
	let Fin4ClaimingContract = new ethers.Contract(
		addresses[4],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Claiming.json').abi,
		provider
	);

	// 6 Fin4Verifying
	let Fin4VerifyingContract = new ethers.Contract(
		addresses[6],
		require(config.CONTRACTS_BUILD_DIRECTORY + '/Fin4Verifying.json').abi,
		provider
	);
});

contract.on('TestEvent', (...args) => {
	console.log('ethers received TestEvent');
	io.emit('message', 'TestEvent received');
});

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
