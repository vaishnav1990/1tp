'use strict'

var Duplex = require('stream').Duplex
var hat = require('hat')
var inherits = require('util').inherits
var myUtils = require('../../utils')
var netstring = require('netstring')
var winston = require('winston')
var winstonWrapper = require('winston-meta-wrapper')

function UdpStream (peerAddress, sessionId, socket, version) {
  if (!(this instanceof UdpStream)) {
    return new UdpStream(peerAddress, sessionId, socket, version)
  }
  // logging
  this._log = winstonWrapper(winston)
  this._log.addMeta({
    module: '1tp:transports:streams:udp'
  })
  // verify attributes
  if (peerAddress.address === undefined || peerAddress.port === undefined) {
    var peerAddressError = 'incorrect peerAddress: address and/or port attribute is undefined'
    throw new Error(peerAddressError)
  }
  // init
  Duplex.call(this, UdpStream.DEFAULTS)

  this._peerAddress = peerAddress
  this._sessionId = (sessionId === null) ? _generateSessionId() : sessionId
  this._socket = socket
  this._version = version

  this._destroyed = false

  // register _error handler
  myUtils.mixinEventEmitterErrorFunction(this)

  // done
  this._log.debug('created new udp stream.')
}

UdpStream.DEFAULTS = {
  allowHalfOpen: true,
  readableObjectMode: false,
  writableObjectMode: false
}

UdpStream.PACKET = {
  SYN: 0x0000,
  SYN_ACK: 0x0001,
  DATA: 0x0010,
  FIN: 0x0011,
  RST: 0x0100
}

inherits(UdpStream, Duplex)

// Half-closes the socket -- i.e. sends a FIN packet.
UdpStream.prototype.end = function () {
  this._log.debug('ending stream for udp session ' + this._sessionId)
  var self = this
  this._sendSignalingMessage(UdpStream.PACKET.FIN, function () {
    self._end()
  })
}

UdpStream.prototype.destroy = function () {
  this._log.debug('closing stream for udp session ' + this._sessionId)
  var self = this
  this._sendSignalingMessage(UdpStream.PACKET.RST, function () {
    self._destroy()
  })
}

UdpStream.prototype._end = function () {
  // end writestream
  UdpStream.super_.prototype.end.call(this)
}

UdpStream.prototype._destroy = function () {
  // destroy stream
  this._destroyed = true
  this.emit('close')
}

UdpStream.prototype._write = function (chunk, encoding, done) {
  var typeByte = new Buffer(2)
  typeByte.writeUInt16BE(UdpStream.PACKET.DATA)
  var sessionIdBytes = netstring.nsWrite(this._sessionId)
  var versionBytes = netstring.nsWrite(this._version)
  var data = Buffer.concat([typeByte, sessionIdBytes, versionBytes, chunk])
  this._socket.send(data, 0, data.length, this._peerAddress.port, this._peerAddress.address, done)
}

UdpStream.prototype._read = function (size) {
  // not supported
}

UdpStream.prototype._sendSignalingMessage = function (message, done) {
  var typeByte = new Buffer(2)
  typeByte.writeUInt16BE(message)
  var sessionIdBytes = netstring.nsWrite(this._sessionId)
  var versionBytes = netstring.nsWrite(this._version)
  var data = Buffer.concat([typeByte, sessionIdBytes, versionBytes])
  this._socket.send(data, 0, data.length, this._peerAddress.port, this._peerAddress.address, done)
}

function _generateSessionId () {
  return hat(32, 16)
}

module.exports = UdpStream