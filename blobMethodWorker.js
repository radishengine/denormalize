
importScripts('require.js');

onmessage = function(e) {
  var typeName = e.data.type,
      methodName = e.data.method,
      args = e.data.args || [],
      id = e.data.id;
  
  require([typeName],
  
    function(typedef) {
      if (typeof typedef[methodName] !== 'function') {
        postMessage({
          success: false,
          id: id,
          result: 'method '+methodName+' undefined for type '+typeName,
        });
        return;
      }
      var result = typedef[methodName].apply(typedef, args);
      if (!(result instanceof Promise)) result = Promise.resolve(result);
      result.then(
        function(result) {
          postMessage({
            success: true,
            id: id,
            result: result,
          });
        },
        function(msg) {
          postMessage({
            success: false,
            id: id,
            result: msg,
          });
        }
      );
    },
    
    function() {
      postMessage({
        success: false,
        id: id,
        result: 'error loading type: ' + typeName,
      });
    }
    
  );
};
