const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { ethers } = require('ethers');
const port = 5000;

// const config = require('./config.json');
// const rinkebyProvider = new ethers.providers.InfuraProvider("rinkeby", config.INFURA_API_KEY)
const provider = new ethers.providers.JsonRpcProvider('http://localhost:7545');

const json = require('./DevContract.json');
const address = '0x2932281766c7AFc07d14A72f3c53e1631f1aC1C6';

let contract = new ethers.Contract(address, json.abi, provider);

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
	});

	socket.on('message', msg => {
		console.log('message: ' + msg);
	});

	socket.on('disconnect', () => {
		console.log('UNREGISTERED ethAddress: ' + socketIdToEthAddress[socket.id], ' socketId: ', socket.id);
	});
});

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

http.listen(port, () => {
	console.log('listening on port: ', port);
});
