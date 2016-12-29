/*
*   Add functions and/or constants to native Screeps objects
*/

module.exports = function(){
  /*
  * ROOM
  */

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
		Creep.prototype.gather = function(target,resourceType,amount){
			return false
		},

		Creep.prototype.chargeController = function(controller){
			return false
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
			return namesCombined[Memory.creepindex % namesCombined.length]
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
		return false
	  }
  
  /*
  * STRUCTURE_STORAGE
  */
  
  /*
  * STRUCTURE_TERMINAL
  */
  
  /*
  * STRUCTURE_TOWER
  */
  
  /*
  * STRUCTURE_CONTAINER
  */
  
  /*
  * STRUCTURE_PORTAL
  */
  
  /*
  * STRUCTURE_ROAD
  */
  
  /*
  * STRUCTURE_WALL
  */
}