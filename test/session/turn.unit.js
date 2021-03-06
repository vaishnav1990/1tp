'use strict'

var turn = require('turn-js')
var TurnTransports = turn.transports
var TurnSession = require('../../lib/transports/session/turn')

var chai = require('chai')
var expect = chai.expect

if (!process.env.TURN_ADDR) {
  throw new Error('TURN_ADDR undefined -- giving up')
}
if (!process.env.TURN_PORT) {
  throw new Error('TURN_PORT undefined -- giving up')
}
if (!process.env.TURN_USER) {
  throw new Error('TURN_USER undefined -- giving up')
}
if (!process.env.TURN_PASS) {
  throw new Error('TURN_PASS undefined -- giving up')
}

var turnAddr = process.env.TURN_ADDR
var turnPort = parseInt(process.env.TURN_PORT)
var turnUser = process.env.TURN_USER
var turnPwd = process.env.TURN_PASS

describe('Testing turn stream', function () {
  this.timeout(2000)

  it('should return echo messages and end stream', function (done) {
    var clientAlice, clientBob
    clientAlice = turn(turnAddr, turnPort, turnUser, turnPwd, new TurnTransports.TCP())
    clientBob = turn(turnAddr, turnPort, turnUser, turnPwd, new TurnTransports.TCP())
    var connectionInfoAlice, connectionInfoBob
    var streamAlice, streamBob
    var nbTestMessages = 10
    var currentTestMessage = 0

    function sendTestMessage () {
      var testMessage = 'test message ' + currentTestMessage
      streamAlice.write(testMessage)
    }

    // allocate session alice
    clientAlice.initP()
      .then(function () {
        return clientBob.initP()
      })
      .then(function () {
        return clientAlice.allocateP()
      })
      .then(function (allocateAddress) {
        connectionInfoAlice = allocateAddress
        console.log("alice's connectionInfo = " + JSON.stringify(connectionInfoAlice))
        // allocate session bob
        return clientBob.allocateP()
      })
      .then(function (allocateAddress) {
        connectionInfoBob = allocateAddress
        console.log("bob's connectionInfo = " + JSON.stringify(connectionInfoBob))
        // create permission for alice to send messages to bob
        return clientBob.createPermissionP(connectionInfoAlice.relayedAddress.address)
      })
      .then(function () {
        // create permission for bob to send messages to alice
        return clientAlice.createPermissionP(connectionInfoBob.relayedAddress.address)
      })
      .then(function () {
        // create streams
        streamAlice = new TurnSession(connectionInfoBob, clientAlice, 0)
        streamBob = new TurnSession(connectionInfoAlice, clientBob, 0)
        streamBob.pipe(streamBob)
        // config sender
        streamAlice.on('data', function (bytes) {
          var message = bytes.toString()
          console.log('alice received response: ' + message)
          expect(message.toString()).to.equal('test message ' + currentTestMessage++)
          if (currentTestMessage !== nbTestMessages) {
            sendTestMessage()
          } else {
            // clientStream.end()
            // clientStream.emit('end')
            clientAlice.closeP()
              .then(function () {
                return clientBob.closeP()
              })
              .then(function () {
                done()
              })
          }
        })
        // send test message
        sendTestMessage()
      })
  })
})
