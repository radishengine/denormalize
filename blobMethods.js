define(['require'], function(require) {

  'use strict';
  
  const BUFFER_SIZE = 64 * 1024;
  
  const MAX_WORKERS = (navigator && navigator.hardwareConcurrency) || 2;
  var workers = [];
  
  function dispatch(typeName, methodName, args, transferList) {
    var worker;
    if (workers.length < MAX_WORKERS) {
      worker = new Worker(require.toUrl('blobMethodWorker.js'));
      worker.activeCount = 1;
      worker.ids = Object.create(null);
      workers.push(worker);
      worker.terminateTimeout = null;
      worker.addEventListener('message', function(e) {
        var msg = e.data;
        delete worker.ids[msg.id];
        if (--worker.activeCount < 1 && worker.terminateTimeout === null) {
          worker.terminateTimeout = setTimeout(function() {
            workers.splice(workers.indexOf(worker), 1);
            worker.terminate();
          }, 5000);
        }
      });
      worker.addEventListener('error', function(e) {
        workers.splice(workers.indexOf(worker), 1);
      });
    }
    else {
      worker = workers[0|(Math.random() * workers.length)];
      worker.activeCount++;
      if (worker.terminateTimeout !== null) {
        clearTimeout(worker.terminateTimeout);
        worker.terminateTimeout = null;
      }
    }
    var id; do { id = ((Math.random() * 0x7fffffff)|0).toString(16); } while (id in worker.ids);
    worker.ids[id] = true;
    return new Promise(function(resolve, reject) {
      function onmessage(e) {
        var msg = e.data;
        if (msg.id !== id) return;
        worker.removeEventListener('message', onmessage);
        worker.removeEventListener('error', onerror);
        if (msg.success) resolve(msg.result); else reject(msg.result);
      }
      function onerror(e) {
        worker.removeEventListener('message', onmessage);
        worker.removeEventListener('error', onerror);
        reject('worker error');
      }
      worker.addEventListener('message', onmessage);
      worker.addEventListener('error', onerror);
      worker.postMessage(
        {type:typeName, method:methodName, args:args, id:id},
        transferList);
    });
  }
  
  Blob.encode = function(typeName, args, transfer) {
    return dispatch(typeName, 'encode', args, transfer);
  };
  
  Blob.prototype.typeMethod = function(typeName, methodName) {
    var args = [this];
    if (arguments.length > 2) {
      args.push.apply(args, Array.prototype.slice.call(arguments, 2));
    }
    return new Promise(function(resolve, reject) {
      require(
        [typeName],
        function(typedef) {
          if (typeof typedef[methodName] !== 'function') {
            reject('no ' + methodName + ' handler defined for type ' + typeName);
          }
          else {
            resolve(typedef[methodName].apply(typedef, args));
          }
        },
        function() {
          reject('failed to load type handler for ' + typeName);
        });
    });
  };
  
  Blob.prototype.typeMethodAsync = function(typeName, methodName) {
    var args = [this];
    if (arguments.length > 2) {
      args.push.apply(args, Array.prototype.slice.call(arguments, 2));
    }
    return dispatch(typeName, methodName, args, []);
  };
  
  Blob.prototype.decode = function(typeName) {
    return this.typeMethodAsync(typeName, 'decode');
  };
  
  Blob.prototype.read = function(typeName) {
    return this.typeMethod(typeName, 'read');
  };
  
  Blob.prototype.readBuffered = function(sliceFrom, sliceTo) {
    if (sliceTo < sliceFrom) throw new RangeError('sliceTo < sliceFrom');
    var buf = this.buffer;
    if (buf && sliceFrom >= buf.bufferOffset && sliceTo <= (buf.bufferOffset + buf.byteLength)) {
      return Promise.resolve(new Uint8Array(buf, sliceFrom - buf.bufferOffset, sliceTo - sliceFrom));
    }
    var nextBuf = this.nextBuffer;
    if (nextBuf && sliceFrom >= nextBuf.bufferOffset && sliceTo <= (nextBuf.bufferOffset + nextBuf.byteLength)) {
      return nextBuf.then(function(buf) {
        return new Uint8Array(buf, sliceFrom - buf.bufferOffset, sliceTo - sliceFrom);
      });
    }
    var bufferStart = Math.floor(sliceFrom / BUFFER_SIZE) * BUFFER_SIZE;
    var bufferEnd = Math.min(this.size, Math.ceil(sliceTo / BUFFER_SIZE) * BUFFER_SIZE);
    var self = this;
    return (nextBuf = this.nextBuffer = Object.assign(new Promise(function(resolve, reject) {
      var fr = new FileReader;
      fr.onload = function() {
        var buf = this.result;
        buf.bufferOffset = bufferStart;
        self.buffer = buf;
        if (self.nextBuffer === nextBuf) delete self.nextBuffer;
        resolve(buf);
      };
      fr.onerror = function() {
        reject(this.error);
      };
      console.info('readBuffered', self, bufferStart, bufferEnd);
      fr.readAsArrayBuffer(self.slice(bufferStart, bufferEnd));
    }), {
      bufferOffset: bufferStart,
      byteLength: bufferEnd - bufferStart,
    }))
    .then(function(buf) {
      return new Uint8Array(buf, sliceFrom - bufferStart, sliceTo - sliceFrom);
    });
  };
  
  Blob.prototype.readArrayBuffer = function() {
    var self = this;
    return new Promise(function(resolve, reject) {
      var fr = new FileReader;
      fr.onload = function() {
        resolve(this.result);
      };
      fr.onerror = function() {
        reject(this.error);
      };
      fr.readAsArrayBuffer(self);
    });
  };
  
  Blob.prototype.readAllBytes = function() {
    return this.readArrayBuffer().then(function(ab) {
      return new Uint8Array(ab);
    });
  };
  
  Blob.prototype.download = function(filename) {
    var link = document.createElement('A');
    link.setAttribute('href', URL.createObjectURL(this));
    link.setAttribute('download', filename || 'file.dat');
    return new Promise(function(resolve, reject) {
      document.body.appendChild(link);
      link.onclick = function() {
        link.parentNode.removeChild(link);
        resolve();
      };
      link.click();
    });
  };

});
