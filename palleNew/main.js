//PROTOTYPE ADDITIONS
require('prototypes')();
require('globals')();

//Kendalor Code
var operationsHandler = require('operations.handler');
//


module.exports.loop = function () {
	
	//Kendalor Code
	operationsHandler.init();
	operationsHandler.run();
	//  
	
	
	/* // only for debug
		var sources = Game.rooms['sim'].find(FIND_SOURCES);
		for (var i in sources){
			console.log(sources[i].hasFreeSlots());
			//console.log(sources[i].occupy("Peter"));
			console.log(sources[i].deOccupy("Peter"));
		}
	/**/
	
	//console.log(Game.rooms['sim'].sources());
}