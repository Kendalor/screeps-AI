// THIS IS HOW YOU CAN COMMIT IMPORTS
module.exports = function(PROTOTYPES){
	for(var spawnId in Game.spawns)
		console.log(Game.spawns[spawnId].createCustomCreep(1,2)); // Function of prototypes.js
}