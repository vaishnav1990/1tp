'use strict'

var net = require('../../lib/net')

var onetpTransports = require('../../lib/transports')
var TcpTransport = onetpTransports.tcp
var UdpTransport = onetpTransports.udp
var TurnTransport = onetpTransports.turn
var TurnProtocols = require('turn-js').transports
var WebSocketSignaling = require('../../lib/signaling').websocket

var serverInfo = process.env.onetpServerAddress
var turnAddr = process.env.turnAddr
var turnPort = process.env.turnPort
var turnUser = process.env.turnUser
var turnPwd = process.env.turnPwd
var registrar = process.env.registrar

console.log('server info: ' + JSON.stringify(serverInfo))
console.log('turn address: ' + turnAddr)
console.log('turn port: ' + turnPort)
console.log('turn user: ' + turnUser)
console.log('turn password: ' + turnPwd)
console.log('1tp registrar: ' + registrar)

var onetpClient

function done(error) {
  var message = (error === undefined)? 'done': error
  onetpClient.write(message)
}

function launchOneTpClient() {
  var transports = []
  transports.push(new UdpTransport())
//  transports.push(new TcpTransport())
  transports.push(
    new TurnTransport({
      turnServer: turnAddr,
      turnPort: turnPort,
      turnProtocol: new TurnProtocols.UDP(),
      turnUsername: turnUser,
      turnPassword: turnPwd,
      signaling: new WebSocketSignaling({
        url: registrar
      })
    })
  )
  onetpClient = net.createConnection(serverInfo, transports, function () {
    console.log('connection established')
    onetpClient.on('data', function (data) {
      console.log('received message ' + data)
      done()
    })
    onetpClient.write('hello')
  })
}

// start test
if (window.cordova === undefined) {
  launchOneTpClient()
} else {
  document.addEventListener('deviceready', launchOneTpClient, false)
}
