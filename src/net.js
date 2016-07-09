'use strict'

var config = require('./config')
var events = require('events')
var inherits = require('util').inherits
var myUtils = require('./utils')
var ProxyStream = require('./stream')
var Q = require('q')

var onetpTransports = require('./transports')
var TcpTransport = onetpTransports.tcp
var TurnTransport = onetpTransports.turn
var UdpTransport = onetpTransports.udp
var WebSocketSignaling = require('./signaling').websocket

var debug = require('debug')
var debugLog = debug('1tp:net')
var errorLog = debug('1tp:net:error')

// Server class

var Server = function () {
  if (!(this instanceof Server)) {
    return new Server()
  }
  // first optional argument -> transports
  var transports = arguments[0]
  if (transports === undefined || typeof transports !== 'object') {
    debugLog('no transports defined, using default configuration')
    transports = getDefaultTransports()
  }
  // last optional argument -> callback
  var connectionListener = arguments[arguments.length - 1]
  // register connectionListener -- if this is a function
  if (typeof connectionListener === 'function') {
    this.once('connection', connectionListener)
  }
  // create array if single elem
  this._transports = Array.isArray(transports) ? transports : [transports]
  // register event listeners
  this._registerTransportEvents(this._transports, connectionListener)
  // event emitter
  events.EventEmitter.call(this)
  // register _error handler
  myUtils.mixinEventEmitterErrorFunction(this, errorLog)
  // done
  debugLog('created new net stream')
}

// Inherit EventEmitter
inherits(Server, events.EventEmitter)

Server.prototype.listen = function () {
  // first optional argument -> listeningInfo
  var listeningInfo = arguments[0]
  if (listeningInfo === undefined || typeof listeningInfo !== 'object') {
    listeningInfo = []
  }
  // last optional argument -> callback
  var callback = arguments[arguments.length - 1]
  if (typeof callback === 'function') {
    this.once('listening', callback)
  }
  var self = this
  this.listenP(listeningInfo)
    .then(function (collectedListeningInfo) {
      self.emit('listening')
    })
    .catch(function (error) {
      errorLog(error)
      self._error(error)
    })
}

Server.prototype.listenP = function (listeningInfo) {
  // check listening info
  if (listeningInfo === undefined || typeof listeningInfo !== 'object') {
    listeningInfo = []
  }
  // create list of promises
  var listenPromises = this._transports.map(function (transport) {
    var transportListeningInfo = listeningInfo.find(function (listeningInfoInstance) {
      if (listeningInfoInstance.transportType === transport.transportType()) {
        return listeningInfoInstance
      }
    })
    debugLog('binding transport with listening info ' + JSON.stringify(transportListeningInfo))
    return transport.listenP(transportListeningInfo)
  })
  var self = this
  // execute promises
  return Q.all(listenPromises)
    .then(function (collectedListeningInfo) {
      debugLog('collected listening info ' + JSON.stringify(collectedListeningInfo))
      collectedListeningInfo = [].concat.apply([], collectedListeningInfo) // flatten multidimensional array
      self._listeningInfo = collectedListeningInfo
      return collectedListeningInfo
    })
}

Server.prototype.address = function () {
  return this._listeningInfo
}

Server.prototype.close = function () {
  transports.forEach(function (transport) {
    transport.blockIncomingConnections()
  })
}

Server.prototype._registerTransportEvents = function (transports) {
  var self = this
  transports.forEach(function (transport) {
    transport.on('connection', self._onIncomingConnection())
    transport.on('error', function (error) {
      errorLog(error)
      self._error(error)
    })
  })
}

Server.prototype._onIncomingConnection = function () {
  var self = this
  return function (stream, transport, peerConnectionInfo) {
    debugLog('new incoming connection for transport ' + transport.transportType(), ', peerConnectionInfo = ' + JSON.stringify(peerConnectionInfo))
    /* TODO
     * for now, we only support one single transport connection per session
     * multiple transports will be added later on
     */
    var socket = new Socket(transport)
    socket.connectStream(stream)
    socket.remoteAddress = [peerConnectionInfo]

    self.emit('connection', socket)
  }
}

// Socket class

var Socket = function (transports) {
  if (!(this instanceof Socket)) {
    return new Socket(transports)
  }
  if (transports === undefined) {
    debugLog('no transports defined, using default configuration')
    transports = getDefaultTransports()
  }
  // create array if single elem
  this._transports = Array.isArray(transports) ? transports : [transports]
  // init proxy stream
  ProxyStream.call(this)
  // register _error handler
  myUtils.mixinEventEmitterErrorFunction(this, errorLog)
  // done
  debugLog('created new net socket')
}

inherits(Socket, ProxyStream)

Socket.prototype.connect = function (connectionInfo, connectionListener) {
  // verify if connectionInfo is defined
  if (connectionInfo === undefined) {
    var connectionInfoUndefinedError = 'incorrect args: connectionInfo is undefined'
    errorLog(connectionInfoUndefinedError)
    this._error(connectionInfoUndefinedError)
  }
  // register connectionListener -- if this is a function
  if (typeof connectionListener === 'function') {
    this.once('connect', connectionListener)
  }
  // create array of connection infos
  connectionInfo = Array.isArray(connectionInfo) ? connectionInfo : [connectionInfo]
  // prepare connection attempts
  var self = this
  var connectionAttempts = []
  connectionInfo.forEach(function (endpointInfo) {
    var transport = self._transports.find(function (registeredTransport) {
      if (endpointInfo.transportType === registeredTransport.transportType()) {
        return registeredTransport
      }
    })
    if (!transport) {
      debugLog('could not find associated transport for connection info ' + endpointInfo)
      return
    }
    debugLog('preparing to connection attempt with ' + JSON.stringify(endpointInfo))
    connectionAttempts.push({
      transport: transport,
      endpointInfo: endpointInfo
    })
  })
  // create chain of connect promises
  var promiseChain = Q.fcall(function () {
    // start
    return
  })
  var foundStream = false
  connectionAttempts.forEach(function (transportSpecs) {
    if (!foundStream) {
      promiseChain = promiseChain.then(function (stream) {
        // no stream found, execute a new connect promise
        if (!stream) {
          debugLog('no stream found, executing another connect promise')
          var connectTimeoutPromise = _createConnectTimeoutPromise(transportSpecs)
          return connectTimeoutPromise
        // stream is found, fire event and stop further searching
        } else {
          foundStream = true
          debugLog('found stream -- forwarding to next stage')
          return Q.fcall(function () {
            return stream
          })
        }
      })
    }
  })
  // execute promise chain
  promiseChain.then(function (stream) {
    // no stream found -- the end
    if (!stream) {
      var noConnectionError = 'could not establish connection with ' + JSON.stringify(connectionInfo)
      debugLog(noConnectionError)
      self._error(noConnectionError)
    // stream is found -- shout it out loud
    } else {
      debugLog('w00t ... connection established')
      self.connectStream(stream)
      self.remoteAddress = [stream._peerConnectionInfo]
      self.emit('connect')
    }
  }).catch(function (error) {
    errorLog(error)
    self._error(error)
  })
}

Socket.prototype.isConnected = function () {
  return (this._connectedStream !== undefined)
}

Socket.prototype.destroy = function () {
  var errorMsg = 'socket.destroy function not yet implemented'
  errorLog(errorMsg)
// this._error(errorMsg)
}

Socket.prototype.end = function () {
  var errorMsg = 'socket.end function not yet implemented'
  errorLog(errorMsg)
  this._error(errorMsg)
}

// factory functions

var createServer = function () {
  // first optional argument -> transports
  var transports = arguments[0]
  if (transports === undefined || typeof transports !== 'object') {
    debugLog('no transports defined, using default configuration')
    transports = getDefaultTransports()
  }
  // last optional argument -> callback
  var connectionListener = arguments[arguments.length - 1]
  // create new server instance
  return new Server(transports, connectionListener)
}

var createConnection = function () {
  // mandator argument -> connectionInfo
  var connectionInfo = arguments[0]
  if (connectionInfo === undefined || typeof connectionInfo !== 'object') {
    errorLog('connectionInfo undefined')
    return
  }
  // first optional argument -> transports
  var transports = arguments[1]
  if (transports === undefined || typeof transports !== 'object') {
    debugLog('no transports defined, using default configuration')
    transports = getDefaultTransports()
  }
  // last optional argument -> callback
  var connectionListener = arguments[arguments.length - 1]
  // create socket and init connection handshake
  var socket = new Socket(transports)
  socket.connect(connectionInfo, connectionListener)
  // done
  return socket
}

var _createConnectTimeoutPromise = function (transportSpecs) {
  // create connect promise
  var transport = transportSpecs.transport
  var endpointInfo = transportSpecs.endpointInfo
  var connectPromise = transport.connectP(endpointInfo)
  // resolve promise without result if it does not complete before timeout
  var connectTimeoutPromise = myUtils.timeoutResolvePromise(connectPromise, transport.connectTimeout(), function () {
    // on timeout, close connection
    var timeoutMessage = 'timeout while transport ' + transport.transportType() + ' tries to connect with ' + JSON.stringify(endpointInfo)
    debugLog(timeoutMessage)
  // TODO: close transport
  })
  return connectTimeoutPromise
}

var getDefaultTransports = function () {
  var transports = []
  transports.push(new UdpTransport())
  transports.push(new TcpTransport())
  if (config.turnAddr !== undefined &
    config.turnPort !== undefined &
    config.onetpRegistrar !== undefined
  ) {
    transports.push(new TurnTransport({
      turnServer: config.turnAddr,
      turnPort: config.turnPort,
      turnUsername: config.turnUser,
      turnPassword: config.turnPass,
      signaling: new WebSocketSignaling({
        url: config.onetpRegistrar
      })
    }))
  }
  return transports
}

module.exports = {
  createConnection: createConnection,
  createServer: createServer,
  connect: createConnection,
  Server: Server,
  Socket: Socket
}
