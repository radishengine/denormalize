define(function() {

  'use strict';
  
  var curio = {};
  
  curio.showAll = function(item) {
    return true;
  };
  
  curio.properties = {
    _testItem: {
      value: curio.showAll,
      writable: true,
      enumerable: false,
    },
    testItem: {
      get: function() {
        return this._testItem;
      },
      set: function(func) {
        this._testItem = func;
      },
      enumerable: true,
    },
    _searchString: {
      value: '',
      writable: true,
      enumerable: false,
    },
    searchString: {
      get: function() {
        return this._searchString;
      },
      set: function(query) {
        if (!query && query !== false) query = ''; else query += '';
        if (query === this._searchString) return;
        this._searchString = query;
        var pattern = /^([-+])?(?:([^\s":]+):)?(?:"([^"]*)"|(\S+))/gi;
        var terms = [];
        for (var match = pattern.exec(query); match; match = pattern.exec(query)) {
          var negate = match[1] === '-';
          var fieldName = match[2] || 'text';
          var value = match[3] || match[4] || '';
          terms.push({fieldName:fieldName, value:value, negate:negate});
        }
        
      },
    },
    addItem: {
      value: function(item) {
        this.items.appendChild(item);
      },
      enumerable: true,
    },
  };
  
  curio.create = function(id) {
    var curio = document.createElement('DIV');
    curio.className = 'curio';
    curio.appendChild(curio.searchArea = document.createElement('DIV'));
    curio.searchArea.className = 'curio-search-area';
    curio.appendChild(curio.configArea = document.createElement('DIV'));
    curio.configArea.className = 'curio-config-area';
    curio.configArea.appendChild(curio.configArea.countLabel = document.createElement('SPAN'));
    curio.configArea.countLabel.innerText = '0';
    curio.configArea.appendChild(curio.configArea.resultLabel = document.createElement('SPAN'));
    curio.configArea.resultLabel.innerText = ' results';
    curio.appendChild(curio.items = document.createElement('DIV'));
    curio.items.className = 'curio-items';
    Object.defineProperties(curio, curio.properties);
    return curio;
  };
  
  return curio;

});
