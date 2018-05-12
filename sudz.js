
// SUDZ: Some Uncompressed Data in a Zip

// utility for writing simple uncompressed zip files

define(function() {

  'use strict';
  
  // percent-encode same as encodeURIComponent except add . * and leave space
  function encodePathComponent(str) {
    return str.replace(/[^ ]+/g, encodeURIComponent).replace(/[\.\*]/g, function(c) {
      return '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2);
    });
  }
  
  function fetchBlobBytes(blob, offset, length) {
    if (arguments.length > 1) {
      if (offset < 0) {
        if (-offset > blob.size) {
          return Promise.reject('expected ' + (-offset) + ' bytes, got ' + blob.size);
        }
        offset += blob.size;
      }
      if (arguments.length > 2) {
        if ((offset + length) > blob.size) {
          return Promise.reject('expected ' + length + ' bytes, got ' + (blob.size - offset));
        }
        blob = blob.slice(offset, offset + length);
      }
      else if (offset > 0) {
        if (offset > blob.size) {
          return Promise.reject('offset ' + offset + ' beyond maximum (' + blob.size + ')');
        }
        blob = blob.slice(offset);
      }
    }
    return new Promise(function(resolve, reject) {
      var fr = new FileReader();
      function onError(e) {
        fr.removeEventListener('error', onError);
        fr.removeEventListener('loadend', onLoadEnd);
        reject(e.message);
      }
      function onLoadEnd(e) {
        fr.removeEventListener('error', onError);
        fr.removeEventListener('loadend', onLoadEnd);
        resolve(new Uint8Array(this.result));
      }
      fr.addEventListener('error', onError);
      fr.addEventListener('loadend', onLoadEnd);
      fr.readAsArrayBuffer(blob);
    });
  }
  
  var CRC = new Int32Array(256);
  for (var i = 0; i < 256; i++) {
    CRC[i] = i;
    for (var j = 0; j < 8; j++) {
      CRC[i] = CRC[i] & 1 ? 0xEDB88320 ^ (CRC[i] >>> 1) : (CRC[i] >>> 1);
    }
  }
  
  Blob.prototype.getCRC32 = function() {
    var self = this;
    return fetchBlobBytes(this)
    .then(function(bytes) {
      var crc = -1;
      for (var i = 0; i < bytes.length; i++) {
        crc = CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      }
      crc ^= -1;
      self.getCRC32 = Promise.resolve(crc);
      return crc;
    });
  };
  
  var encodeUTF8;
  if ('TextEncoder' in window) {
    var utf8enc = new TextEncoder('utf-8');
    encodeUTF8 = function(str) {
      return utf8enc.encode(str);
    };
  }
  else {
    encodeUTF8 = function(str) {
      var parts = encodeURIComponent(str).match(/%[a-fA-F0-9]{2}|[^%]/g);
      var bytes = new Uint8Array(parts.length);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].length === 3) {
          bytes[i] = parseInt(parts[i].slice(1), 16);
        }
        else {
          bytes[i] = parts[i].charCodeAt(0);
        }
      }
      return bytes;
    };
  }
  
  function SudzWriter() {
    this.files = {};
  }
  SudzWriter.prototype = {
    createBlob: function() {
      var localRecords = [], centralRecords = [];
      localRecords.byteLength = centralRecords.byteLength = 0;
      var localTemplate = new Uint8Array(0x1E);
      var centralTemplate = new Uint8Array(0x2E);
      localTemplate.set([
        0x50, 0x4B, 0x03, 0x04, // PK signature
        0x0A, 0x00, // zip spec version
        0x00, 0x08, // flags: utf-8
      ]);
      centralTemplate.set([
        0x50, 0x4B, 0x01, 0x02, // PK signature
        0x0A, 0x00, // zip spec version, creating system
        0x0A, 0x00, // required zip spec version
        0x00, 0x08, // flags: utf-8
      ]);
      var allPaths = Object.keys(this.files);
      var now = new Date();
      var promisedCRCs = [];
      function setCRC(file, localDV, centralDV) {
        promisedCRCs.push(file.getCRC32().then(function(crc) {
          localDV.setInt32(0xE, crc, true);
          centralDV.setInt32(0x10, crc, true);
        }));
      }
        
      for (var i = 0; i < allPaths.length; i++) {
        var path = allPaths[i];
        var file = this.files[path];
        var pathBytes = encodeUTF8(path);
        
        var lastModified;
        if (typeof file.lastModifiedISO8601 === 'string') {
          lastModified = new Date(file.lastModifiedISO8601);
        }
        else if (typeof file.lastModified === 'number') {
          lastModified = new Date(file.lastModified);
        }
        else {
          lastModified = file.lastModifiedDate || now;
        }
        var dosDate = lastModified.getUTCDate()
            | ((lastModified.getUTCMonth() + 1) << 5)
            | (((lastModified.getUTCFullYear() - 1980) & 0x31) << 9);
        var dosTime = (lastModified.getUTCSeconds() >> 1)
            | (lastModified.getUTCMinutes() << 5)
            | (lastModified.getUTCHours() << 11);
        
        var local = new Uint8Array(localTemplate);
        var central = new Uint8Array(centralTemplate);
        
        var localDV = new DataView(local.buffer, local.byteOffset, local.byteLength);
        var centralDV = new DataView(central.buffer, central.byteOffset, central.byteLength);
        
        centralDV.setUint16(0x0C, dosTime, true);
        centralDV.setUint16(0x0E, dosDate, true);
        centralDV.setUint32(0x14, file.size, true);
        centralDV.setUint32(0x18, file.size, true);
        centralDV.setUint16(0x1C, pathBytes.length, true);
        centralDV.setUint32(0x2A, localRecords.byteLength, true);
        
        centralRecords.push(central, pathBytes);
        centralRecords.byteLength += central.length + pathBytes.length;
        
        localDV.setUint16(0x0A, dosTime, true);
        localDV.setUint16(0x0C, dosDate, true);
        localDV.setUint32(0x12, file.size, true);
        localDV.setUint32(0x16, file.size, true);
        localDV.setUint16(0x1A, pathBytes.length, true);
        
        localRecords.push(local, pathBytes, file);
        localRecords.byteLength += local.length + pathBytes.length + file.size;
        
        setCRC(file, localDV, centralDV);
      }
      var suffix = new Uint8Array(0x16);
      suffix.set([
        0x50, 0x4B, 0x05, 0x06, // PK signature
      ]);
      var suffixDV = new DataView(suffix.buffer, suffix.byteOffset, suffix.byteLength);
      suffixDV.setUint16(0x08, allPaths.length, true);
      suffixDV.setUint16(0x0A, allPaths.length, true);
      suffixDV.setUint32(0x0C, centralRecords.byteLength, true);
      suffixDV.setUint32(0x10, localRecords.byteLength, true);
      var parts = localRecords.concat(centralRecords, [suffix]);
      return Promise.all(promisedCRCs).then(function() {
        return new Blob(parts, {type:'application/zip'});
      });
    },
  };
  
  var sudz = {
    Writer: SudzWriter,
  };
  
  return sudz;

});
