module.exports = function(){

	/*
	GAME
	*/

	/*
	* ROOM
	*/
	Room.prototype.exampleAttribute = 'attribute';

	/*
	* ROOM_POSITION
	*/

	/*
	* ROOM_OBJECT
	*/

	/*
	* CONTRUCTION_SITE
	*/

	/*
	* CREEP
	*/
		/** NEEDS TESTING
		 * Reserves specific amount of specific resource for set amount of ticks on given container
		 * Uses StructureStorage.prototype.reserveResource = function(objectId,resource,amount,ticks)
		 *  or StructureContainer.prototype.reserveResource = function(objectId,resource,amount,ticks)
		 * @param {Object} container or storage
		 * @param {String} resource
		 * @param {Number} amount
		 * @param {Number} ticks
		 * @return {Number} errorCode
		 */
		Creep.prototype.reserveResource = function(container,resource=RESOURCE_ENERGY,amount=this.carryCapacity,ticks=50){
			if (container.structureType && (container.structureType == STRUCTURE_STORAGE || container.structureType == STRUCTURE_CONTAINER)) {
				container.reserveResource(this.id,resource,amount,ticks);
			}else {return ERR_INVALID_TARGET;}
		},
	
		/** NEEDS TESTING
		 * Creep moves to target container and reserves an amount of resource
		 * Uppon reaching target the creep withdraws the reserved resource amount and cancels the reservation
		 * Used by screep.reserveResource(container,[resource],[amount],[ticks])
		 * @param {Number} objectId of reserver
		 * @param {String} resource
		 * @param {Number} amount
		 * @param {Number} ticks
		 * @return {Number} errorCode
		 */
		Creep.prototype.gather = function(objectId,resource,amount,ticks=50){
			var errorCode = OK;
			//TODO
			return errorCode;
		},

		Creep.prototype.chargeController = function(controller){
			return false;
		},

		Creep.prototype.getRandomName = function(){
			var names1 = ["Jackson", "Aiden", "Liam", "Lucas", "Noah", "Mason", "Jayden", "Ethan", "Jacob", "Jack", "Caden", "Logan", "Benjamin", "Michael", "Caleb", "Ryan", "Alexander", "Elijah", "James", "William", "Oliver", "Connor", "Matthew", "Daniel", "Luke", "Brayden", "Jayce", "Henry", "Carter", "Dylan", "Gabriel", "Joshua", "Nicholas", "Isaac", "Owen", "Nathan", "Grayson", "Eli", "Landon", "Andrew", "Max", "Samuel", "Gavin", "Wyatt", "Christian", "Hunter", "Cameron", "Evan", "Charlie", "David", "Sebastian", "Joseph", "Dominic", "Anthony", "Colton", "John", "Tyler", "Zachary", "Thomas", "Julian", "Levi", "Adam", "Isaiah", "Alex", "Aaron", "Parker", "Cooper", "Miles", "Chase", "Muhammad", "Christopher", "Blake", "Austin", "Jordan", "Leo", "Jonathan", "Adrian", "Colin", "Hudson", "Ian", "Xavier", "Camden", "Tristan", "Carson", "Jason", "Nolan", "Riley", "Lincoln", "Brody", "Bentley", "Nathaniel", "Josiah", "Declan", "Jake", "Asher", "Jeremiah", "Cole", "Mateo", "Micah", "Elliot"]
			var names2 = ["Sophia", "Emma", "Olivia", "Isabella", "Mia", "Ava", "Lily", "Zoe", "Emily", "Chloe", "Layla", "Madison", "Madelyn", "Abigail", "Aubrey", "Charlotte", "Amelia", "Ella", "Kaylee", "Avery", "Aaliyah", "Hailey", "Hannah", "Addison", "Riley", "Harper", "Aria", "Arianna", "Mackenzie", "Lila", "Evelyn", "Adalyn", "Grace", "Brooklyn", "Ellie", "Anna", "Kaitlyn", "Isabelle", "Sophie", "Scarlett", "Natalie", "Leah", "Sarah", "Nora", "Mila", "Elizabeth", "Lillian", "Kylie", "Audrey", "Lucy", "Maya", "Annabelle", "Makayla", "Gabriella", "Elena", "Victoria", "Claire", "Savannah", "Peyton", "Maria", "Alaina", "Kennedy", "Stella", "Liliana", "Allison", "Samantha", "Keira", "Alyssa", "Reagan", "Molly", "Alexandra", "Violet", "Charlie", "Julia", "Sadie", "Ruby", "Eva", "Alice", "Eliana", "Taylor", "Callie", "Penelope", "Camilla", "Bailey", "Kaelyn", "Alexis", "Kayla", "Katherine", "Sydney", "Lauren", "Jasmine", "London", "Bella", "Adeline", "Caroline", "Vivian", "Juliana", "Gianna", "Skyler", "Jordyn"]
			var namesCombined = _.flatten(_.map(names1, function(v, i) { return [v, names2[i]]; }));
			if(!Memory.creepindex || Memory.creepindex >= namesCombined.length) {
				Memory.creepindex = 0
			}else{
				Memory.creepindex++
			}
			return namesCombined[Memory.creepindex % namesCombined.length];
		},


	/*
	* FLAG
	*/

	/*
	* MINERAL
	*/

	/*
	* NUKE
	*/

	/*
	* RESOURCE
	*/

	/*
	* SOURCE
	*/

	/*
	* STUCTURE
	*/

	/*
	* OWNED_STRUCTURE
	*/

	/*
	* STRUCTURE_CONTROLLER
	*/

	/*
	* STRUCTURE_EXTENSION
	*/

	/*
	* STRUCTURE_EXTRACTOR
	*/

	/*
	* STRUCTURE_KEEPER_LAIR
	*/

	/*
	* STRUCTURE_LAB
	*/

	/*
	* STRUCTURE_LINK
	*/

	/*
	* STRUCTURE_NUKER
	*/

	/*
	* STRUCTURE_OBSERVER
	*/

	/*
	* STRUCTURE_POWER_BANK
	*/

	/*
	* STRUCTURE_POWER_SPAWN
	*/

	/*
	* STRUCTURE_RAMPART
	*/

	/*
	* STRUCTURE_SPAWN
	*/
		StructureSpawn.prototype.createCustomCreep = function(spawnEnergyCap, creepType){
			//TODO
			return false;
		},

		StructureSpawn.prototype.enQueueCreep = function(body, name,memory,priority){
			//TODO
			return false;
		},

		StructureSpawn.prototype.isCreepInQueue = function(body, name,memory,priority){
			return false;
		},

		StructureSpawn.prototype.deQueueCreep = function(body, name,memory,priority){
			return false;
		},

	/*
	* STRUCTURE_STORAGE
	*/
		/** NEEDS TESTING
		 * Identical to StructureContainer.prototype.reserveResource
		 * Reserves specific amount of specific resource for set amount of ticks
		 * Used by screep.reserveResource(container,[resource],[amount],[ticks])
		 * @param {Number} objectId (of reserver)
		 * @param {String} resource
		 * @param {Number} amount
		 * @param {Number} ticks
		 * @return {Number} errorCode
		 */
		StructureStorage.prototype.reserveResource = function(objectId,resource,amount,ticks){
			var errorCode = OK;
			//TODO
			return errorCode;
		},
	
		/** NEEDS TESTING
		 * Checks for expired reservations and cancels them
		 * Substracts stored resource with reserved resource
		 * Identical to StructureContainer.prototype.availableResource
		 * @param {String} resource
		 * @return {Number} availableRes
		 */
		StructureStorage.prototype.availableResource = function(resource){
			var availableRes = 0;
			//TODO
			return availableRes;
		},
		
		

	/*
	* STRUCTURE_TERMINAL
	*/

	/*
	* STRUCTURE_TOWER
	*/

	/*
	* STRUCTURE_CONTAINER
	*/
		/** NEEDS TESTING
		 * Identical to StructureStorage.prototype.reserveResource
		 * Reserves specific amount of specific resource for set amount of ticks
		 * Used by screep.reserveResource(container,[resource],[amount],[ticks])
		 * @param {Number} objectId of reserver
		 * @param {String} resource
		 * @param {Number} amount
		 * @param {Number} ticks
		 * @return {Number} errorCode
		 */
		StructureContainer.prototype.reserveResource = function(objectId,resource,amount,ticks){
			var errorCode = OK;
			//TODO
			return errorCode;
		},
	
		/** NEEDS TESTING
		 * Checks for expired reservations and cancels them
		 * Substracts stored resource with reserved resource
		 * Identical to StructureStorage.prototype.availableResource
		 * @param {String} resource
		 * @return {Number} availableRes
		 */
		StructureContainer.prototype.availableResource = function(resource){
			var availableRes = 0;
			//TODO
			return availableRes;
		},

	/*
	* STRUCTURE_PORTAL
	*/

	/*
	* STRUCTURE_ROAD
	*/

	/*
	* STRUCTURE_WALL
	*/
		StructureWall.prototype.stub = function(stub){
			return false;
		}
}