requirejs.config({
  waitSeconds: 0,
});

define([],
function() {

  'use strict';
  
  console.log('hello... newman world');
  
  function onfile(file) {
    console.log(file);
  }
  
  var dragdrop = document.getElementById('dragdrop');
  
  dragdrop.ondragenter = function(e) {
    if (e.target !== this) return;
  };
  
  dragdrop.ondragover = function(e) {
    this.classList.add('dropping');
    e.preventDefault();
  };
  
  dragdrop.ondragleave = function(e) {
    if (e.target !== this) return;
    this.classList.remove('dropping');
  };
  
  dragdrop.ondrop = function(e) {
    e.preventDefault();
    this.classList.remove('dropping');
    for (var i = 0; i < e.dataTransfer.files.length; i++) {
      onfile(e.dataTransfer.files[i]);
    }
  };
  
});
