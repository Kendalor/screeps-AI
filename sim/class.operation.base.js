

module.exports = class{
        constructor(){
        }

        static run(id){
            /*
            SWITCH CASE OVER CURRENT STATUS AND CONTROLLER LEVEL
            */
            if(!this.checkForDelete(id)){
                this.refreshMemory(id);
                switch(Game.rooms[Memory.operations[id].roomName].controller.level){
                    //                              EVERYTHING SUBECET TO CHANGE
                    //CONTROLLER LEVEL 1
                    //IN: AT START OF ROOM
                    //OUT: IF CONTROLLER REACHES LEVEL 2
                    //GOAL: (IN ORDER)
                    //       1) INITIALIZE MEMORY
                    //       2) BUILD APPROPRIATE NUMBER OF CREEPS
                    //       3) UPGRADE CONTROLLER LEVEL
                    case 1:
                        this.runLvl1(id);
                        break;
                    //CONTROLLER LEVEL 2
                    //IN: AFTER REACHING CONTROLLER LEVEL 2, NOT @ MAX EXTENSIONS
                    //OUT: IF CONTROLLER REACHES LEVEL 3
                    //GOAL: (IN ORDER)
                    //      BUILD EXTENSIONS
                    //      RUSH TO CONTROLLER LEVEL 3
                    case 2:
                        break;
                    //CONTROLLER LEVEL 3
                    //IN: AFTER REACHING CONTROLLER LEVEL 3, NOT @ MAX EXTENSIONS
                    //OUT: IF CONTROLLER REACHES LEVEL 4
                    //GOAL: (IN ORDER)
                    //      BUILD EXTENSIONS
                    //      BUILD TOWER
                    //      BUILD CONTAINER
                    //      BUILD ROADS
                    //      CONVERT TO MINER/HAULER SETUP
                    //      RUSH TO CONTROLLER LEVEL 4
                    case 3:
                        break;

                }
            }
        }

        static runLvl1(id){
            var room=Game.rooms[Memory.operations[id].roomName];
            //SPAWNING CREEPS
            var body=[WORK,CARRY,MOVE,MOVE];
            //var body=[WORK,WORK,CARRY,MOVE];
            var units=Object.keys(Game.rooms[Memory.operations[id].roomName].memory.creeps).length;
            var spawn=Game.getObjectById(Object.keys(room.memory.spawns)[0]);
            if(room.memory.baseSpecs.max_workers > units && room.energyAvailable >= 250 && !spawn.spawning){
                spawn.createCreep(body,{job: 'harvest', operation_id: id});
            }
            // NEED TO SPAWN ?
            if(Object.keys(room.memory.baseSpecs.members).length < room.memory.baseSpecs.max_workers){
                // CAN SPAWN ?
                if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {job: 'harvest', operation_id: id}) == OK){
                    // SPAWN !
                    var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep(creep_body,undefined,{job: 'harvest', operation_id: id});
                    room.memory.baseSpecs.members[name]= 'harvest';
                    console.log('Did spawn creep '+name);
                }

            }
            var energyLessCreeps=_.filter(room.memory.creeps, (cr) => cr.carry.energy == 0);
            var sources;
            for(var i in energyLessCreeps){
                console.log(energyLessCreeps[i]);
            }

        }

        static init(roomName,flag){
            if(!Game.flags[flag].memory.operation_id){
                if(!Memory.operations){
                        Memory.operations={};
                }
                this.id=parseInt(Math.random()*10000000);
                console.log(this.isIdFree(this.id));
                while(!this.isIdFree(this.id)){
                    this.id=parseInt(Math.random()*10000000);
                }

                this.roomName=roomName;
                console.log(flag);
                console.log(this.id);
                console.log(this.roomName);
                this.flagName=flag;

                Game.flags[flag].memory.operation_id=this.id;

                if(!Memory.operations[this.id]){
                    Memory.operations[this.id]={}
                }
                //DEFINE ALL OP VARIABLES HERE
                Memory.operations[this.id].roomName=roomName;
                Memory.operations[this.id].flagName=flag;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='base';
                this.initMemory(this.id);
                console.log(JSON.stringify(Memory.operations[this.id]));
            }
        }
        // CHECK IF ID IS AVAILABLE
        static isIdFree(id){
            var out=true;
            for(var i in Memory.operations){
                if(Memory.operations[id]){
                    out= false;
                }
            }
            return out;
        }
        // INIT ROOM MEMORY FOR EVERYTHING HERE
        static initMemory(id){
			console.log(!Game.rooms[Memory.operations[id].roomName].sources)
        // SOURCES ( OLD CODE)
            if(!Game.rooms[Memory.operations[id].roomName].memory.sources){//If this room has no sources memory yet
                Game.rooms[Memory.operations[id].roomName].memory.sources = {}; //Add it
                var room= Game.rooms[Memory.operations[id].roomName];
                var sources = room.find(FIND_SOURCES);//Find all sources in the current room
                var spawns = room.find(FIND_MY_SPAWNS)
                for(var i in sources){
                    var source = sources[i];
                    source.memory = Game.rooms[Memory.operations[id].roomName].memory.sources[source.id] = {}; //Create a new empty memory object for this source
                    // GET ACCESSIBLE POSITIONS FOR EACH SOURCE
                    var positions=_.filter(Game.rooms[Memory.operations[id].roomName].lookAtArea(source.pos.y-1,source.pos.x-1,source.pos.y+1,source.pos.x+1,{asArray: true}), (temp) => temp.type == 'terrain' && temp.terrain != 'wall').length
                    Game.rooms[Memory.operations[id].roomName].memory.sources[source.id].slots=positions;
                    Game.rooms[Memory.operations[id].roomName].memory.sources[source.id].harvesters=[];
                    Game.rooms[Memory.operations[id].roomName].memory.sources[source.id].d_spawn=PathFinder.search(source.pos,{pos: spawns[0].pos, range: 1}).path.length;
                    Game.rooms[Memory.operations[id].roomName].memory.sources[source.id].d_controller=PathFinder.search(source.pos,{pos: source.room.controller.pos, range: 3}).path.length;
                }
            }
        // SPAWNS
            if(!Game.rooms[Memory.operations[id].roomName].memory.spawns){//If this room has no sources memory yet
                Game.rooms[Memory.operations[id].roomName].memory.spawns = {}; //Add it
                var room= Game.rooms[Memory.operations[id].roomName];
                var spawns = room.find(FIND_MY_SPAWNS);//Find all sources in the current room
                for(var i in spawns){
                    var spawn = spawns[i];
                    Game.rooms[Memory.operations[id].roomName].memory.spawns[spawn.id] = spawn.memory = {} //Create a new empty memory object for this source
                }
            }
        // CONSTRUCTION SITES AS ID HASH LIST
            if(!Game.rooms[Memory.operations[id].roomName].memory.constructionSites){//If this room has no construction sites memory yet
                Game.rooms[Memory.operations[id].roomName].memory.constructionSites = {}
            }
        // MY CREEPS AS LIST WITH NAMES(HASK KEYS)
            if(!Game.rooms[Memory.operations[id].roomName].memory.creeps){//If this room has no creep memory yet
                Game.rooms[Memory.operations[id].roomName].memory.creeps = {}
            }
		// HOSTILE CREEPS AS LIST WITH NAMES(HASK KEYS)
			if(!Game.rooms[Memory.operations[id].roomName].memory.hostileCreeps){//If this room has no hostile creep memory yet
				Game.rooms[Memory.operations[id].roomName].memory.hostileCreeps = {}
			}
        // BUILDINGS AS ID LIST
            if(!Game.rooms[Memory.operations[id].roomName].memory.structures){//If this room has no structures memory yet
                Game.rooms[Memory.operations[id].roomName].memory.structures = {}
            }

        // PARAMETERS
            if(!Game.rooms[Memory.operations[id].roomName].memory.baseSpecs){
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs = {}
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.mode='default';
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.security='safe';
                var max_workers=0;
                for(var i in Game.rooms[Memory.operations[id].roomName].memory.sources){
                    max_workers=max_workers+Game.rooms[Memory.operations[id].roomName].memory.sources[i].slots;
                }
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.max_workers=max_workers;
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.temp_slot_counter=0;
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.temp={};
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.members={};
            }
        }

        // RUN EVERYTICK
        //TO READ EVERYTHING FROM ROOM INTO MEMORY
        static refreshMemory(id){
            console.log('refreshing Memory');
            var creeps=Game.rooms[Memory.operations[id].roomName].find(FIND_MY_CREEPS);
            var hostile_creeps=Game.rooms[Memory.operations[id].roomName].find(FIND_HOSTILE_CREEPS);
            var structures=Game.rooms[Memory.operations[id].roomName].find(FIND_STRUCTURES);
            var constructions=Game.rooms[Memory.operations[id].roomName].find(FIND_CONSTRUCTION_SITES);
            delete Game.rooms[Memory.operations[id].roomName].memory.creeps;
            Game.rooms[Memory.operations[id].roomName].memory.creeps={};
            for(var i in creeps){
                Game.rooms[Memory.operations[id].roomName].memory.creeps[creeps[i].name]=creeps[i];
            }
            delete Game.rooms[Memory.operations[id].roomName].memory.structures;
            Game.rooms[Memory.operations[id].roomName].memory.structures={};
            for(var i in structures){
                Game.rooms[Memory.operations[id].roomName].memory.structures[structures[i].id]=structures[i];
            }
            delete Game.rooms[Memory.operations[id].roomName].memory.hostileCreeps;
            Game.rooms[Memory.operations[id].roomName].memory.hostileCreeps={};
            for(var i in hostile_creeps){
                Game.rooms[Memory.operations[id].roomName].memory.hostileCreeps[hostile_creeps[i].id]=hostile_creeps[i];
            }
            delete Game.rooms[Memory.operations[id].roomName].memory.constructionSites;
            Game.rooms[Memory.operations[id].roomName].memory.constructionSites={};
            for(var i in constructions){
                Game.rooms[Memory.operations[id].roomName].memory.constructionSites[constructions[i].id]=constructions[i];
            }
        }

        static temp_slot_counter(id){
            var hasFreeSlots=false;
            for(var i in Game.rooms[Memory.operations[id].roomName].memory.sources){
                    if(Game.getObjectById(i).hasFreeSlots == true){
                        hasFreeSlots=true;

                    }else if(Game.getObjectById(i).hasFreeSlots == undefined){
                        console.log('Error');
                    }
            }

            if(Game.ticks % 50 == 0){
                var units=Object.keys(Game.rooms[Memory.operations[id].roomName].memory.creeps).length;
                if(units == Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.max_workers && Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.temp_slot_counter >= 40){
                    Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.max_workers=Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.max_workers-1;

                }else if(units == Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.max_workers && Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.temp_slot_counter <= 20){
                    Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.max_workers=Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.max_workers+1;
                }
                Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.temp_slot_counter=0;
            }else{
                if(hasFreeSlots){
                    Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.temp_slot_counter=Game.rooms[Memory.operations[id].roomName].memory.baseSpecs.temp_slot_counter+1;
                }
            }
        }

        static checkForDelete(id){
            var flagname =  Memory.operations[id].flagName;
            if(!Game.flags[flagname] && !Memory.operations[id].permanent){
                delete Memory.flags[flagname];
                delete Memory.operations[id];
                return true;
            }else {
                return false;
            }
        }
};
