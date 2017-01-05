var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};

module.exports = class{

        constructor(){

        }
        static run(id){
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED
            switch (Memory.operations[id].status){
                case 'assembling':
                    this.assembling(id);
                    break;
                case 'traveling':
                    this.traveling(id);
                    console.log('Run Travel');
                    break;
                case 'combat':
                    this.combat(id);
                    break;
                default:
                    console.log('default');
                    break;
            }





            }
        }
        static assembling(id){
            this.buildCreeps(id);
            this.checkForCreeps(id);
            if(this.checkAssembled_ByRallyPoint(id)){
                Memory.operations[id].status='traveling';
            }
            for(var sLeader in Memory.operations[id].squads){
                for(var cr in Memory.operations[id].squads[sLeader]){

                    if(!Game.creeps[Memory.operations[id].squads[sLeader][cr]].spawning){
                        Game.creeps[Memory.operations[id].squads[sLeader][cr]].moveTo(Game.creeps[sLeader]);
                        Game.creeps[Memory.operations[id].squads[sLeader][cr]].heal(sLeader);
                    }
                }
                if(!Game.creeps[sLeader].spawning){

                        Game.creeps[sLeader].moveTo(Game.getObjectById(Memory.operations[id].rallyPoint));
                }
            }
        }

        static traveling(id){
            var wait=false;
            var err;
            var moving;
            var creep;
            for(var sLeader in Memory.operations[id].squads){
                creep=Game.creeps[sLeader];
                for(var cr in Memory.operations[id].squads[sLeader]){
					if (Game.creeps[Memory.operations[id].squads[sLeader][cr]].room.name == Game.creeps[sLeader].room.name) // Just in case if leader is blocking the path, leave the edge of the map
						this.creepLeaveBorder(Game.creeps[Memory.operations[id].squads[sLeader][cr]],Game.creeps[sLeader].pos);
                    Game.creeps[Memory.operations[id].squads[sLeader][cr]].moveTo(Game.creeps[sLeader]);
                    err=Game.creeps[Memory.operations[id].squads[sLeader][cr]].heal(Game.creeps[sLeader]);

                    if(err == ERR_NOT_IN_RANGE){
                        wait=true;
                    }
                }
                moving=(creep.pos.x >= 48 || creep.pos.y >= 48 || creep.pos.x <= 1 || creep.pos.y <= 1); // In some cases leader blocks followers (e.g. small passage or corner)
                if(!wait){
                    Game.creeps[sLeader].moveTo(Game.flags[Memory.operations[id].flagName]);
                }else if(moving){
                    Game.creeps[sLeader].moveTo(Game.flags[Memory.operations[id].flagName]);
                }
                if(Game.creeps[sLeader].pos.roomName == Game.flags[Memory.operations[id].flagName].pos.roomName){

                    creep.moveTo(Game.flags[Memory.operations[id].flagName]);
                    Memory.operations[id].status='combat';
                }
            }
        }

        static combat(id){
            this.checkForCreeps(id);
            var enemies=undefined;
            var wait=false;
            var err;
            var target;
            if(Object.keys(Memory.operations[id].squads).length > 0){
                for(var sLeader in Memory.operations[id].squads){
                    for(var cr in Memory.operations[id].squads[sLeader]){
						if (Game.creeps[Memory.operations[id].squads[sLeader][cr]].room.name == Game.creeps[sLeader].room.name) // Just in case if leader is blocking the path, leave the edge of the map
							this.creepLeaveBorder(Game.creeps[Memory.operations[id].squads[sLeader][cr]],Game.creeps[sLeader].pos);
                        Game.creeps[Memory.operations[id].squads[sLeader][cr]].moveTo(Game.creeps[sLeader]);

                        err=Game.creeps[Memory.operations[id].squads[sLeader][cr]].heal(Game.creeps[sLeader]);
                        if(err == ERR_NOT_IN_RANGE){
                            wait=true;
                            Game.creeps[Memory.operations[id].squads[sLeader][cr]].heal(Game.creeps[Memory.operations[id].squads[sLeader][cr]]);
                        }
                        if(Game.creeps[sLeader].hits == Game.creeps[sLeader].hitsMax ){
                            Game.creeps[Memory.operations[id].squads[sLeader][cr]].heal(Game.creeps[Memory.operations[id].squads[sLeader][cr]]);
                        }
                    }
                    //console.log('BUGFIX');
                    if(Game.creeps[sLeader].pos.roomName == Game.flags[Memory.operations[id].flagName].pos.roomName){
                        //console.log('BUGFIX');
                        //console.log(enemies);
                        if(enemies == undefined){
                            var enemies=Game.creeps[sLeader].room.find(FIND_HOSTILE_CREEPS);
							//enemies=Game.creeps[sLeader].room.find(FIND_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_WALL}); // ALTERNATIVE FOR DEMOLISHING WALLS - NOT WORKING PROPERLY ATM
                        }
                        if(enemies.length >0){
                            console.log('rly');
                            target=Game.creeps[sLeader].pos.findClosestByPath(enemies);
                            err=Game.creeps[sLeader].attack(target);
                            if(err == ERR_NOT_IN_RANGE){
                                if(!wait){
                                    Game.creeps[sLeader].moveTo(target);
                                }
                            }
                        }else{

                            if(!wait){
                                Game.creeps[sLeader].moveTo(Game.flags[Memory.operations[id].flagName]);
                            }
                        }
                    }
                }
				//if(Game.flags[Memory.operations[id].flagName].room.name != Game.creeps[sLeader].room.name){ // If you want to avoid combat and just wanna move on.
                if(enemies == undefined){
                    Memory.operations[id].status='traveling';
                }
            }else{
                Memory.operations[id].status='assembling';
            }

        }
        /*
        TODO: REASSIGN HEALERS HEADLESS HEALERS TO FALL BACK AND ASSIGN THEM A NEW SQUAD
        */
        static checkForCreeps(id){
            var creepName;
            for(var sLeader in Memory.operations[id].squads){
                creepName=sLeader;
                for(var cr in Memory.operations[id].squads[sLeader]){
                    creepName=Memory.operations[id].squads[sLeader][cr]
                    if(!Game.creeps[creepName]){
                        console.log('Deleted Healer '+creepName +'from memory')
                        delete Memory.creeps[creepName];
                        Memory.operations[id].squads[sLeader].pop(creepName);
                    }

                }
                if(!Game.creeps[sLeader]) {
                        console.log('Deleted '+ sLeader +' from memory')
                        delete Memory.creeps[sLeader];


                        for(var cr in Memory.operations[id].squads[sLeader]){
                                console.log('Deleted '+cr +'from memory')
                                Memory.operations[id].squads[sLeader].pop(cr);
                                Game.creeps[creepName].suicide();
                                delete Memory.creeps[creepName];
                        }
                        delete Memory.operations[id].squads[sLeader];
                }
            }
        }


        static buildCreeps(id){
            if(Object.keys(Memory.operations[id].squads).length < Memory.operations[id].size){
                var creep_body=Memory.operations[id].default_Abody;
                //console.log(creep_body);
                //console.log(Array(10).fill('TOUGH',0,5).fill('MOVE',5,8).fill('ATTACK',8,10))
                //console.log(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}));
                if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}) == OK){
                    var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep(creep_body,undefined,{role: 'attacker', operation_id: id, target: Memory.operations[id].flagName});
                    Memory.operations[id].squads[name]= [];
                    console.log('Did spawn Squad Captain '+name);
                }

            }else{
                var creep_body=Memory.operations[id].default_Hbody;
                for(var sLeader in Memory.operations[id].squads){
                    if(Object.keys(Memory.operations[id].squads[sLeader]).length < Memory.operations[id].healers){
                        if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {role: 'healer', operation: id, Leader: sLeader, target: Memory.operations[id].flagName}) == OK){
                            var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep(creep_body,undefined,{role: 'healer', operation_id: id, Leader: sLeader, target: Memory.operations[id].flagName});

                            Memory.operations[id].squads[sLeader].push(name);

                        }
                    }
                }
            }
            // CHECK IF REACHED OR FLAG POSITION CHANGED
        }

        static checkAssembled(id){
            var out=true;
            if(Object.keys(Memory.operations[id].squads).length == Memory.operations[id].size){
                    for(var sLeader in Memory.operations[id].squads){
                        if(Memory.operations[id].squads[sLeader].length != Memory.operations[id].healers){
                            out=false;
                        }else{
                            for(var cr in Memory.operations[id].squads[sLeader]){
                                if(Game.creeps[cr].spawning){
                                    out = false;
                                }
                            }
                        }
                    }

            }else{
                out = false;
            }
            return out;

        }

        static checkAssembled_ByRallyPoint(id){
            var out=true;
            if(Object.keys(Memory.operations[id].squads).length == Memory.operations[id].size){
                for(var sLeader in Memory.operations[id].squads){
                    if(Memory.operations[id].squads[sLeader].length == Memory.operations[id].healers){
                        for(var cr in Memory.operations[id].squads[sLeader]){
                            if(!Game.creeps[Memory.operations[id].squads[sLeader][cr]].pos.inRangeTo(Game.getObjectById(Memory.operations[id].rallyPoint),3)){
                                out=false;
                            }
                        }
                    }else{
                        out=false;
                    }
                }
                if(!Game.creeps[sLeader].pos.inRangeTo(Game.getObjectById(Memory.operations[id].rallyPoint),3)){
                        out=false;
                }
            }else{
                out = false;
            }
            return out;
        }

        static findClosestSpawn(flagName){
            var min_length;
            var best_spawn;
            var length;
            for(var i in Game.spawns){
                console.log('length from '+Game.spawns[i].pos.roomName+' to '+Game.flags[flagName].pos.roomName);
                console.log( Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length < min_length  || min_length == undefined);
                length= Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length;
                if(length < min_length  || min_length == undefined){
                    min_length=length;
                    best_spawn=Game.spawns[i].id;
                }
            }
            return best_spawn;
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
                Memory.operations[this.id].flagPos= Game.flags[flag].pos;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='defend';
                Memory.operations[this.id].size=1; // NUMBER OF SQUADS ATTACKER = SQUAD LEADER
                Memory.operations[this.id].healers=1; // NUMBER OF HEALERS PER SQUAD
                //COST 12xMOVE = 600 + 12 ATTACK = 960 =1560
                Memory.operations[this.id].default_Abody=Array(50).fill(TOUGH,0,28).fill(MOVE,28,36).fill(ATTACK,36,50);// COST 2300
                //Memory.operations[this.id].default_Abody=Array(50).fill(TOUGH,0,20).fill(MOVE,20,30).fill(ATTACK,30,50);// COST 2300
                //Memory.operations[this.id].default_Abody=[MOVE,ATTACK]; //TEST
                // COST 1800 6xHEAL= 1500 + 6xMOVE = 300   == 1800
                Memory.operations[this.id].default_Hbody=Array(20).fill(TOUGH,0,10).fill(MOVE,10,16).fill(HEAL,17,20);
                //Memory.operations[this.id].default_Hbody=[MOVE,HEAL]; //TEST
                Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                Memory.operations[this.id].status='assembling';
                Memory.operations[this.id].squads= {};
                Memory.operations[this.id].rallyPoint=Game.getObjectById(Memory.operations[this.id].nearest_spawnId).pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;


                //console.log(JSON.stringify(Memory.operations[this.id]));
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
        // CHECK IF FLAG IS STILL EXISITING, IF NOT => DELETE OPERATION IF NOT PERMANENT
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

        static checkForDelete_new(id){

            if(!Memory.operations[id].flagName && !Memory.operations[id].permanent && Object.keys(Memory.operations[id].squads).length == 0){
                delete Memory.flags[flagname];
                delete Memory.operations[id];

                return true;
            }else if(!Game.flags[Memory.operations[id].flagName] && !Memory.operations[id].permanent && Object.keys(Memory.operations[id].squads).length > 0){
                delete Memory.operations[id].flagName;

                return false;

            }else {
                return false;
            }

        }

        static refreshTimer(creep){
            var target = Game.spawns['Spawn1'];
            if(target.renewCreep(creep) == ERR_NOT_IN_RANGE){
                creep.moveTo(target)
            }else if(target.renewCreep(creep) == ERR_FULL){
                this.creep.Idle(creep);
            }
        }

		static creepLeaveBorder(creep,leaderPos){
			var pos = new RoomPosition(leaderPos.x,leaderPos.y,leaderPos.roomName)
			if (creep.pos.x == 0){
				switch(creep.pos.y - leaderPos.y){
					case -1: creep.move(RIGHT); break;
					case  0: 
						pos.y = pos.y-1;
						if (creep.moveTo(pos) == ERR_NO_PATH){
							pos.y = pos.y+2;
							creep.moveTo(pos);
						}
					break;
					case  1: creep.move(RIGHT); break;
				}
			}else if(creep.pos.y == 0){
				switch(creep.pos.x - leaderPos.x){
					case -1: creep.move(BOTTOM); break;
					case  0: 
						pos.x = pos.x-1;
						if (creep.moveTo(pos) == ERR_NO_PATH){
							pos.x = pos.x+2;
							creep.moveTo(pos);
						}
					break;
					case  1: creep.move(BOTTOM); break;
				}
			}else if(creep.pos.x == 49){
				switch(creep.pos.y - leaderPos.y){
					case -1:	creep.move(LEFT); break;
					case  0: 
						pos.y = pos.y-1;
						if (creep.moveTo(pos) == ERR_NO_PATH){
							pos.y = pos.y+2;
							creep.moveTo(pos);
						}
					break;
					case 1: creep.move(LEFT); break;
				}
			}else if(creep.pos.y == 49){
				switch(creep.pos.x - leaderPos.x){
					case -1: creep.move(TOP); break;
					case  0: 
						pos.x = pos.x-1;
						if (creep.moveTo(pos) == ERR_NO_PATH){
							pos.x = pos.x+2;
							creep.moveTo(pos);
						}
					break;
					case  1: creep.move(TOP); break;
				}
			}
		}




};
