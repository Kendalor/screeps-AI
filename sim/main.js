require('prototypes')();
require('globals')();
const profiler = require('screeps-profiler');

var autoCreep         = require('auto.creep');
var autoMemory        = require('auto.memory');
var autoSpawn         = require('auto.spawn');
var invasionCounter   = require('invasion.counter');

//Kendalor Code
var operationsHandler = require('operations.handler');

Game.blubb={ bla1: function() {console.log('FUCK');}};
Game.blubb.bla2= function() {console.log('THIS');};

module.exports.loop = function () {

	if (Game.cpu.bucket < 10000){ // To check if accumulated bonus CPU is used sometimes
		console.log("Used additional CPU.\nAccumulated bucket:  "+Game.cpu.bucket+"/10000");
	}
	var operations={};
    operations={tellMe: function() { console.log('No One can Help you')}};
	//Kendalor Code
    Game.blubb={ bla1: function() {console.log('FUCK');}};
    Game.blubb.bla2= function() {console.log('THIS');};
	operationsHandler.init();
	operationsHandler.run();

	if(!Memory.myRooms){
	    Memory.myRooms={};
	    for (var name in Game.rooms){
	        if(Game.rooms[name].controller.my){
	            Memory.myRooms[name]={};
				Game.rooms[name].findMinerals();
				Game.rooms[name].findSources();
            }
	    }
	}

	for(var name in Memory.myRooms) {

		var room = Game.rooms[name];

		invasionCounter.run(room);

		autoSpawn.run(room);

		autoCreep.run(room);

	}

	if(Game.time % 100 == 0){
		autoMemory.clearDeadCreeps();
	}
}