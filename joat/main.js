var roleHarvester = require('role.harvester');
var roleUpgrader = require('role.upgrader');
var roleBuilder = require('role.builder');
var roleAttacker = require('role.attacker');

var MAX_HARVESTERS=10
var MAX_BUILDERS=5
var MAX_UPGRADERS=5
var MIN_BUILDERS=1
var MIN_UPGRADERS=1
var MIN_HARVESTERS=5
var ACC_CPU=0
var WORKER_PRESETS = [[WORK,CARRY,MOVE,CARRY,CARRY],[WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE]];
var MINER_PRESETS = [MOVE,WORK,WORK,WORK]
//Lets first add a shortcut prototype to the sources memory:
Source.prototype.memory = undefined;





module.exports.loop = function () {
    var hostiles=Game.spawns['Spawn1'].room.find(FIND_HOSTILE_CREEPS);
    if(hostiles.length>0){
        //Game.spawns['Spawn1'].room.controller.activateSafeMode();
    }
    for(var roomName in Game.rooms){//Loop through all rooms your creeps/structures are in
        var room = Game.rooms[roomName];
        if(!room.memory.sources){//If this room has no sources memory yet
            room.memory.sources = {}; //Add it
            var sources = room.find(FIND_SOURCES);//Find all sources in the current room
            for(var i in sources){
                var source = sources[i];
                source.memory = room.memory.sources[source.id] = {}; //Create a new empty memory object for this source
                //Now you can do anything you want to do with this source
                //for example you could add a worker counter:
                source.memory.workers = 0;
            }
        }

    }
    if(!Memory.squads){
        Memory.squads={};
    }
    for(var flag in Game.flags){
        if(Game.flags[flag].color == COLOR_RED){
            if(!Memory.squads[Game.flags[flag].name]){
                Memory.squads[Game.flags[flag].name]= {}
                Memory.squads[Game.flags[flag].name].members={};
                Memory.squads[Game.flags[flag].name].size=5;
                Memory.squads[Game.flags[flag].name].target=flag;
                Memory.squads[Game.flags[flag].name].assembled=false;
                Memory.squads[Game.flags[flag].name].reached=false;

            }
        }

    }


    for(var squad in Memory.squads){
        if(!Game.flags[squad]){
            delete Memory.squads[squad];
            for(creep in Game.creeps){
             var cr = Game.creeps[creep];
             if(cr.memory.role == 'attacker'){
                cr.suicide();
             }
            }

        }

        if(Object.keys(Memory.squads[squad].members).length < Memory.squads[squad].size && !Memory.squads[squad].assembled){
            //console.log('Spawning');
            console.log(Game.spawns['Spawn1'].createCreep([ATTACK,ATTACK,TOUGH,TOUGH,TOUGH,ATTACK,ATTACK,TOUGH,TOUGH,TOUGH,ATTACK,ATTACK,TOUGH,TOUGH,TOUGH,ATTACK,ATTACK,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE], undefined, {role: 'attacker', squad: squad, target: Memory.squads[squad].target}))
            /*if(Game.spawns['Spawn1'].createCreep([ATTACK,ATTACK,TOUGH,TOUGH,TOUGH], undefined, {role: 'attacker', squad: squad, target: Memory.squads[squad].target})){
                Memory.squads[squad].count = Memory.squads[squad].count+1;
            }*/

        }else if(Object.keys(Memory.squads[squad].members).length == Memory.squads[squad].size && !Memory.squads[squad].assembled){
            Memory.squads[squad].assembled = true;
            console.log('Squad assembled');
        }


    }


    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            delete Memory.creeps[name];
            console.log('Clearing non-existing creep memory:', name);
        }
    }

    var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');

    var builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder');

    var upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader');

    //Get Tick for reset







    if(Game.time % 5 == 0){
    for(var name in Game.rooms) {
        var structures = Game.rooms[name].find(FIND_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_TOWER});
        for( i in structures){
            if(structures[i]) {


                var closestHostile = structures[i].pos.findClosestByRange(FIND_HOSTILE_CREEPS);
                if(closestHostile) {
                    structures[i].attack(closestHostile);
                }else{
                    var closestDamagedStructure = structures[i].pos.findClosestByRange(FIND_STRUCTURES, {
                        filter: (structure) => (structure.hits < structure.hitsMax && structure.structureType != STRUCTURE_WALL)
                    });
                    if(closestDamagedStructure) {
                        structures[i].repair(closestDamagedStructure);
                }
                }


            }
        }
        if(Game.time % 20 == 0){
            console.log('Aktuallisiere GSpieltaktik');
            var energyCap=Game.rooms[name].energyCapacityAvailable;
            var controlerlvl = Game.rooms[name].controller.level;
            if(controlerlvl == 1){
                Game.rooms[name].memory.defaultworker = 0;
            }else if(controlerlvl == 2 && energyCap == 550){
                Game.rooms[name].memory.defaultworker = 1;
            }
        }

        //Berechne Effizienz

        var energyRatio = Game.rooms[name].energyAvailable/Game.rooms[name].energyCapacityAvailable;


        if(harvesters.length < MAX_HARVESTERS && Game.rooms[name].energyAvailable  && Game.spawns['Spawn1'].canCreateCreep(WORKER_PRESETS[Game.rooms[name].memory.defaultworker], undefined, {role: 'harvester'}) == 0){
            var newName = Game.spawns['Spawn1'].createCreep(WORKER_PRESETS[Game.rooms[name].memory.defaultworker], undefined, {role: 'harvester'});
            console.log('Spawning new harvester: ' + newName);
        }


        console.log('Room "'+name+'" has  Energy: '+Game.rooms[name].energyAvailable+' Harvesters: '+harvesters.length+' Current Workerpreset '+ WORKER_PRESETS[Game.rooms[name].memory.defaultworker]);
        /*
        //SOURCES AUSLASTUNG



        for(var creep in Game.creeps){
            if(Game.creeps[creep].room.name == name && Game.creeps[creep].memory.target && Game.creeps[creep].memory.harvesting){
                Game.rooms[name].memory.source[Game.creeps[creep].memory.target]=Game.rooms[name].memory.source[Game.creeps[creep].memory.target]+1;

            }

        }

        */

    }
    }


    for(var name in Game.creeps) {



        var creep = Game.creeps[name];
        if(creep.memory.role == 'harvester') {
            roleHarvester.run(creep);
        }
        if(creep.memory.role == 'upgrader') {
            roleUpgrader.run(creep);
        }
        if(creep.memory.role == 'builder') {
            roleBuilder.run(creep);
        }

        if(creep.memory.role == 'attacker') {
            roleAttacker.run(creep);
        }

    }




    //var temp=Game.cpu.getUsed();
    //console.log('CPU Used: '+ temp);
}