define(['./parse', './encode'], function(wasm_parse, wasm_encode) {

  'use strict';
  
  // for plugin use, e.g. require(['wasm/load!./mymodule']) to load ./mymodule.wat
  
  // TODO: indexeddb-based caching
  
  return {
    load: function(name, parentRequire, onload, config) {
      fetch(parentRequire.toUrl(name+'.wat?cb='+Math.random()))
      .then(function(response) {
        if (response.ok) return response.text();
        return Promise.reject(response.url + ': ' + response.status + ' ' + response.statusText);
      })
      .then(function(wat) {
        var wasm_blob = wasm_encode(wasm_parse(wat));
        return new Promise(function(resolve, reject) {
          var fr = new FileReader;
          fr.onerror = function() {
            reject(fr.error);
          };
          fr.onload = function() {
            resolve(new Uint8Array(fr.result));
          };
          fr.readAsArrayBuffer(wasm_blob);
        });
      })
      .then(function(wasm) {
        if (!WebAssembly.validate(wasm)) {
          return Promise.reject('invalid wasm');
        }
        return WebAssembly.compile(wasm);
      })
      .then(onload, function(reason) {
        if (!(reason instanceof Error)) reason = new Error(reason);
        onload.error(reason);
      });
    },
    normalize: function(name, normalize) {
      // use standard module name normalization
      return normalize(name);
    },
  };

});
