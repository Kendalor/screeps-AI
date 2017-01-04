require('prototypes')();

//Kendalor Code
var operationsHandler = require('operations.handler');

//




module.exports.loop = function () {
  

  
  //Kendalor Code
    operationsHandler.init();
    operationsHandler.run();
  //  
  
  // for testing purposes
  var sources = Game.rooms['sim'].find(FIND_SOURCES);
		for (var i in sources){
			//console.log(sources[i].hasFreeSlots());
	}

}