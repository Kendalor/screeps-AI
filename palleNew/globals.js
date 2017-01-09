module.exports = function(){
	var FRIENDS = ["Cade","InfiniteJoe","Iskarioth","Kendalor","Palle"];
	
	/* 
	 * Add constants to Memory
	 */
	if (!Memory.globals){
		Memory.globals = {};
	}
	if (!Memory.globals.friend){
		Memory.globals.friend = {};
	}
	for (let i in FRIENDS){
		if(!Memory.globals.friend[FRIENDS[i]]){
			console.log("Added "+FRIENDS[i]+" to friends.");
			Memory.globals.friend[FRIENDS[i]]={};
		}
	}
}