/*
var operations = require('fs').readdirSync(__dirname).forEach(function (file) {
  // If its the current file ignore it 
  if (file === 'index.js') return;

  // Store module with its name (from filename)
  module.exports[path.basename(file, '.js')] = require(path.join(__dirname, file));
});
*/

// WANT TO TRY DO LOAD ALL OPERATIONS DYNAMICLY -> LOAD EVERY FILE WHICH IS NAMED 'class.operation.*'
var operations = null;//require(expr ? "class.operation.")

module.exports = {

	run: function() {
		this.handleNewFlag()
	},

	handleNewFlag: function() {
        for(var flag in Game.flags){
            //if(Game.flags[flag].color == COLOR_WHITE && Game.flags[flag].secondaryColor == COLOR_WHITE){
            //    scoutingOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
        }
		
		for(var i in operations)
			console.log(operations[i]);
    }


};
