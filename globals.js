module.exports = function(){
	var ALLY = ["Cade",
				"dragoonreas",
				"InfiniteJoe",
				"Iskarioth",
				"Kendalor",
				"KermitFrog",
				"Palle"];
	
	/* 
	 * Add constants to Memory
	 */
	if (!Memory.globals){
		Memory.globals = {};
	}
	
	/*
	* Add allys to memory
	*/
	if (!Memory.globals.ally){
		Memory.globals.ally = {};
	}
	for (let i in ALLY){
		if(!Memory.globals.ally[ALLY[i]]){
			console.log("Added "+ALLY[i]+" to allys.");
			Memory.globals.ally[ALLY[i]]={};
		}
	}
	
	
	
	/*
	* Remove old globals or memory entries
	*
	if (Memory.globals.friend){
		delete Memory.globals.friend;
	}
	for (let entry in Memory.rooms){
		if (Object.keys(Memory.rooms[entry]) == 0){
			delete Memory.rooms[entry];
		}else{
			if (Memory.rooms[entry].myCreeps){
				delete Memory.rooms[entry].myCreeps;
			}
			if (Memory.rooms[entry].alliedCreeps){
				delete Memory.rooms[entry].alliedCreeps;
			}
			if (Memory.rooms[entry].hostileCreeps){
				delete Memory.rooms[entry].hostileCreeps;
			}
		}
	}
	/*
	*/
}