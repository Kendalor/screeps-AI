import { AutoMemory } from "../../../legacy/AutoMemory";
import { SpawnConfigAutoSpawn } from "../../../legacy/SpawnConfigAutoSpawn";
import { TowerManager } from "../TowerManager";
import { RoomData } from "./RoomData";
import { RoomOperation } from "./RoomOperations/RoomOperation";
import { RoomOperationInterface } from "./RoomOperations/RoomOperationInterface";
import { SpawnManager } from "./spawn/SpawnManager";



export class RoomManager {
    public roomName: string;
    public room: Room;
    //public tmgr: TowerManager;
	//public config: SpawnConfigAutoSpawn;
	public data: RoomData;
	public spawnmgr: SpawnManager;



	// TEMPORARY PLACE, REMOVE THIS 
	public WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};

    constructor(roomName: string) {
		this.roomName = roomName;
        this.room = Game.rooms[roomName];
		//this.tmgr = new TowerManager(this.room);
		//this.config = new SpawnConfigAutoSpawn(this.room);
		this.data = new RoomData(this);
		this.spawnmgr = new SpawnManager(this.roomName);
		if(this.data.operations.length === 0){
			console.log("Encountered No Operations on Startup");
			if(this.room !== undefined) {
				console.log("Detected Room Object");
				if(this.room.controller !== undefined) {
					console.log(".. with Controller");
					if(this.room.controller.my){
						console.log("which is mine! ... Addding Operations!");
					}
				}			}
		}
	}
	/**
	 * Start of Tick Method
	 */

	public init(): void {
		this.loadList();
		if(this.room !== undefined ){
			console.log("Running RoomManger for Room: " + this.roomName);
			// this.tmgr.run();
			// this.autoSpawn();
			// this.autoCreep(this.room.myCreeps);
		} else {
			console.log("ERROR: "+ this.roomName + "Cant Manage Room which is undefined");
		}
	}
	/**
	 * Run Method executed per tick
	 */
    public run(): void {
		this.init();
		while( this.hasNextOperation()) {
			this.runNextOperation();
		}
	}
	/**
	 * End of Tick Method
	 */
	public destroy(): void {
		// TODO
	}

    /**
     * Load toSpawnList from Memory
     */

    public loadList(){
		this.data.saveOperationList();
    }
/**
 *  save toSpawnList from Meory
 */
    public saveList(){
		this.data.loadOperationList();
    }

    /**
     * push a new RoomOperation into the operations List of the RoomManager
     * @param entry RoomOperation
     */
    public enque(entry: RoomOperation){
        this.data.operations.push(new RoomOperation(this, entry as RoomOperationInterface));
    }
/**
 * remove a new RoomOperation from the operations List of the RoomManager
 * @param entry RoomOperation
 */
    public dequeue(entry: RoomOperation){
        _.remove(this.data.operations, (e) => { return (e.type === entry.type && e.name === entry.name) 
        });
    }
/**
 * Run the next runable RoomOperation in the operations List with the highest Priority
 */
    public runNextOperation(): void {
		const op = this.getNextOperation();
		if( op !== undefined ) {
			try {
					op.run();
				
			} catch (error) {
				console.log("ERROR running Op:" + op.name + "With Error: " +error);
			}
		}
	}

	public getNextOperation(): RoomOperation | undefined {
		// TODO
		if(this.data.operations.length > 0){
			return this.data.operations.filter((entry: RoomOperation) => entry.pause === 0 && entry.didRun === false).sort((entryA,entryB) => entryA.priority - entryB.priority)[0];
		} else {
			return undefined;
		}
	}
	public hasNextOperation(): boolean {
		if(this.data.operations.length > 0){
			return this.data.operations.filter((entry: RoomOperation) => entry.pause === 0 && entry.didRun === false).sort((entryA,entryB) => entryA.priority - entryB.priority).length >0;
		}
		return false;
	}
	
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////        THEORETICAL END OF FILE        //////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////




    public autoSpawn(): void {

        const spawnList: StructureSpawn[] = this.room.find(FIND_MY_SPAWNS);
        // for every spawn in the list
        // for(var id in spawnList) {

        const config = this.config;

        if (spawnList.length > 0){
            const spawn: StructureSpawn= spawnList[spawnList.length-1];
            const ctrlLvl: number =  (spawn.room.controller !== undefined)  ? spawn.room.controller.level: 0;
            const sources: Source[] = this.room.find(FIND_SOURCES);

            if(spawn.spawning === null && spawn.isActive() === true){

                for(const i of config.roles){
                    console.log("Check for Spawn: " + i);
                    // check for amount of creep types in room
                    if(this.room.energyAvailable > 0) {
                        console.log("Energy available");

                        switch(i) {
    
                            case "defender":
                                if (spawn.room.memory.underAttack && config.currentPopulation[i] === 0){
                                    const body: BodyPartConstant[] = config.presets[i];
                                    const spawnTest =  spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {dryRun: true });
                                    console.log(spawnTest);
                                    if(spawnTest === OK) {
                                        spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {memory: {role: "defender"}});
                                    };
                                }
                                break;
    
                            case "miner": 
                                if(config.currentPopulation[i] < config.targetPopulation[i]){
                                    console.log("Reached case: " + i);
                                    console.log(sources !== undefined);
                                    for(const s of sources){
                                        const body = config.presets[i];
                                        const spawnTest =  spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {dryRun: true });
                                        console.log(spawnTest);
                                        if(spawnTest === OK) {
											console.log("Passed Spawntest");
											let found = true;
											console.log(spawn.room.myCreeps.filter((creep) => creep.memory.source === s.id && creep.memory.role === 'miner' ).length );
                                            if(spawn.room.myCreeps.filter((creep) => creep.memory.source === s.id && creep.memory.role === 'miner' ).length === 0 && found){
												console.log("Trying to Spawn");
                                                spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {memory: {role: i, source: s.id, spawn: true}});
                                                found = false;
                                            }
                                        }
                                    }
                                }
    
                                break;
    
    
                            case "hauler":
                            if(config.currentPopulation[i] < config.targetPopulation[i]){
                                    if(sources && config.currentPopulation.miner >= config.currentPopulation.hauler && config.currentPopulation.hauler < (Object.keys(sources).length)){ // spawned when storage is available
                                        for(const s of sources){
                                            if(!spawn.room.memory.sources[s.id].requiredCarryParts){
                                                AutoMemory.resetSourceMemory(spawn.room);
                                            }
                                            let found = true;
                                            if (spawn.room.memory.sources[s.id].container){
                                                if(spawn.room.myCreeps.filter((creep) => creep.memory.source === s.id && creep.memory.role === 'hauler' && ((creep.ticksToLive !== undefined) ? creep.ticksToLive: 1500) > (6+8*spawn.room.memory.sources[s.id].requiredCarryParts) ).length === 0 && found){
                                                    const body = config.presets.hauler;
                                                    const spawnTest =  spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {dryRun: true });
                                                    console.log(spawnTest);
                                                    if(spawnTest === OK) {
                                                        spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {memory: {role: i, source: s.id, spawn:true}});
                                                        found = false;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                break;
    
							case "maintenance":
								console.log(config.currentPopulation[i] + "<" + config.targetPopulation[i]);
                                if(config.currentPopulation[i] < config.targetPopulation[i]){ 
                                    console.log("Reached case: " + i);
                                    console.log(sources !== undefined);
                                    console.log(config.currentPopulation.miner >= (Object.keys(sources).length));
                                    console.log(config.currentPopulation.maintenance < config.targetPopulation.maintenance);
                                    if(sources !== undefined && config.currentPopulation.maintenance < config.targetPopulation.maintenance){
                                        console.log("Need for Spawn");
										const body = config.presets.maintenance;
										console.log(JSON.stringify(config));
										console.log("Body:" + body);
										console.log("Name" + i+spawn.room.name+ (Game.time % 1500));
                                        const spawnTest =  spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {dryRun: true });
                                        console.log(spawnTest);
                                        if(spawnTest === OK) {
                                            spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {memory: {role: i}});
                                        }
                                    }
                                }
                                break;
    
                            case "supplier": 
                                if(config.currentPopulation.supplier < config.targetPopulation.supplier && spawn.room.storage && spawn.room.storage.store.energy > 1000){
                                    const body = config.presets.supplier;
                                    if(spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {dryRun: true }) === OK){
                                        spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {memory: {role: i}});
                                    }
                                }
                                break;
    
                            case "upgrader": 
                                if(config.currentPopulation.upgrader < config.targetPopulation.upgrader && spawn.room.storage !== undefined && config.currentPopulation.miner === Object.keys(sources).length && config.currentPopulation.hauler === Object.keys(sources).length){

                                    const body = config.presets.upgrader;
                                    if(spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {dryRun: true }) === OK){
                                        spawn.spawnCreep(body, i+spawn.room.name+ (Game.time % 1500), {memory: {role: i, workModules: 15}});
                                    }
                                }
                                break;
    
    
                            default:
                                console.log("auto.spawn: Undefined creep's role: "+i)
                            }
                        } 
                }
            }

        }
    }
      
    public autoCreep(creepList: Creep[]): void {


		for (const creep of creepList){
			const job: string = creep.memory.job;

			switch(creep.memory.role) {
                
                // MINER
				case "miner":

					if(creep.memory.spawn){
						if(creep.room.memory.sources === undefined ){
							AutoMemory.initSourceMemory(creep.room);
						}

						creep.room.memory.sources[creep.memory.source].minerId = creep.id;
						delete creep.memory.spawn;
					}

					if (creep.room.energyCapacityAvailable < 500) {
                        this.allrounder(creep);
                    }else {
                        this.miner(creep);
                    }
					break;
                // HAULER
				case "hauler":
					if (creep.memory.spawn){
						creep.room.memory.sources[creep.memory.source].haulerId = creep.id;
						delete creep.memory.spawn;
					}
					if(!creep.memory.containerId){
						const containerPos = creep.room.memory.sources[creep.memory.source].containerPos;
						// let container = creep.room.find(FIND_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_CONTAINER && struct.pos.x == containerPos.x && struct.pos.y == containerPos.y});
						const container = creep.room.containers.filter((struct) => struct.pos.x === containerPos.x && struct.pos.y === containerPos.y);
						if (container.length){
							creep.memory.containerId = container[0].id;
							this.hauler(creep);
						}
						else{
							creep.say("No Container");
						}
					}else{
						this.hauler(creep);
					}
					break;
				// Maintenance	
				case "maintenance":
					// var container = creep.room.find(FIND_STRUCTURES, {filter: (s) => (s.structureType == STRUCTURE_CONTAINER || s.structureType == STRUCTURE_STORAGE) && s.store[RESOURCE_ENERGY] > creep.carryCapacity});
					let container: StructureContainer[] | StructureStorage[]= [];
					if (creep.room.storage){ 
						container = [creep.room.storage].filter((s) => s.store[RESOURCE_ENERGY] > creep.carryCapacity);
					}
					if (container.length === 0 && creep.room.memory.structures.container){
						container = creep.room.containers.filter((s) => s.store[RESOURCE_ENERGY] > creep.carryCapacity);
					}
					if (container.length === 0 || (creep.room.memory.activeCreepRoles.miner === 0 && creep.room.memory.activeCreepRoles.hauler === 0)){
						this.allrounder(creep);
					}
					else {
						this.maintance(creep);
					}
					break;
                // UPGRADER
				case "upgrader":
					this.upgrader(creep);
					break;
                // DEFENDER
				case "defender":
					this.defender(creep);
					break;
                // Supplier
				case "supplier":
					this.supplier(creep);
					break;
			
			}			
		}
	}

    public allrounder(creep: Creep): void {
		if (creep.room.controller!.level > 2){
		this.repairCancel(creep);
		this.upgradeCancel(creep);

		}
		this.mineCancel(creep);
		this.gatherCancel(creep);

		if(creep.room.controller!.level <= 2 && creep.room.controller!.ticksToDowngrade < 1000){
            this.upgrade(creep);
        }
		this.haul(creep);  
		this.build(creep);
		if (creep.room.controller!.level <= 2){
			this.repair(creep);
			this.upgrade(creep);
		}
		this.salvage(creep);
		this.harvest(creep);
	}

	public miner(creep: Creep): void {
		this.salvageCancel(creep);
		this.repairCancel(creep);
		this.harvestCancel(creep);
		this.gatherCancel(creep);
		this.haulCancel(creep);
		this.buildCancel(creep);
		this.upgradeCancel(creep);

		this.mine(creep);
	}

	public hauler(creep: Creep): void {
		this.haul(creep);
		this.salvage(creep);
		this.gather(creep);
		if (!creep.memory.job){
			if (0 === creep.carry.energy && creep.memory.containerId){
				this.travel(creep,creep.memory.containerId);
			}else if(!creep.room.storage && creep.carryCapacity === creep.carry.energy){
				if (!creep.memory.spawnId){
					const spawn = creep.pos.findClosestByPath(creep.room.spawns);
					if (spawn){
						creep.memory.spawnId = spawn.id;
						this.travel(creep,creep.memory.spawnId);
					}
				}else{
					this.travel(creep,creep.memory.spawnId);
				}
			}
		}
	}

	public maintance(creep: Creep): void {
	    if (!creep.memory.job) {
            if(creep.room.controller!.ticksToDowngrade < 5000){
                this.upgrade(creep);
            }
            
			// if(creep.room.memory.underAttack)
			//    this.repair(creep);
			
			this.repair(creep);
			this.build(creep);
			
			this.haul(creep);
			this.upgrade(creep);
			this.salvage(creep);
			this.gather(creep);
		}else{
			switch(creep.memory.job) {
				case 'build':
					this.build(creep);
					break;
				case 'gather':
					this.gather(creep);
					break;
				case 'haul':
					this.haul(creep);
					break;
				case 'repair':
					this.repair(creep);
					break;
				case 'salvage':
					this.salvage(creep);
					break;
				case 'upgrade':
					this.upgrade(creep);
					break;
				default:
					this.harvestCancel(creep);
			}
		}
	}

	public upgrader(creep: Creep): void {
		this.gather(creep);
		this.upgrade(creep);
	}

	public defender(creep: Creep): void {
		this.defend(creep);
	}
	
	public supplier(creep: Creep): void {
		this.haul(creep);
		this.gather(creep);
		if (!creep.memory.job && creep.carry.energy === creep.carryCapacity){
			if (!creep.memory.spawnId){
				const spawn = creep.pos.findClosestByPath(creep.room.spawns);
				if (spawn){
					creep.memory.spawnId = spawn.id;
					this.travel(creep,creep.memory.spawnId);
				}
			}else{
				this.travel(creep,creep.memory.spawnId);
			}
		}
	}

	public harvest(creep: Creep): void {
		if(!creep.memory.job && creep.carry.energy < creep.carryCapacity){
			let sources = creep.room.sources;
			// sources = creep.room.find(FIND_SOURCES); 
			if(creep.room.memory.sources === undefined) {
				AutoMemory.initSourceMemory(creep.room);
			}
			sources = sources.filter((s) => (creep.room.memory.sources[s.id].slots > creep.room.memory.sources[s.id].slotsUsed && s.energy > 0));
			
			if (sources.length > 0){
				const source  = creep.pos.findClosestByPath(sources);
				if (source != null){
					this.anounceJob(creep,'harvest');
					creep.memory.tmpSource = source.id;
					creep.room.memory.sources[source.id].slotsUsed++;
				}else{
					creep.say("No path!")
					this.relax(creep);
				}
			}else{
				creep.say("No source!");
				this.relax(creep);
			}
		}
		if(creep.memory.job === 'harvest' && creep.carry.energy < creep.carryCapacity){
            const source: Source | null = Game.getObjectById(creep.memory.tmpSource);
            if( source !== null ){
                if(creep.inRangeTo(source,1)) {
                    if (source.energy){
                        creep.harvest(source);
                    }
                }else{
                    creep.travelTo(source);
                }
            }

		}
		if(creep.memory.job === 'harvest' && creep.carry.energy === creep.carryCapacity){
			if (!(!creep.memory.tmpSource)){
				creep.room.memory.sources[creep.memory.tmpSource].slotsUsed--;
				delete creep.memory.tmpSource;
			}
			this.idle(creep);
		}
	}

	public harvestCancel(creep: Creep): void {
		if (creep.memory.job === 'harvest'){
			if(creep.memory.tmpSource !== undefined){
				creep.room.memory.sources[creep.memory.tmpSource].slotsUsed--;
				delete creep.memory.tmpSource;
			}
			this.idle(creep);
		}
	}

	public mine(creep: Creep): void {
		// var tmpContainer = creep.pos.lookFor('structure').filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
		let pos = creep.room.memory.sources[creep.memory.source].containerPos;
		pos = new RoomPosition(pos.x,pos.y,pos.roomName);
		if (!creep.memory.job){
			this.anounceJob(creep,'mine');
			creep.room.memory.sources[creep.memory.source].slotsUsed++;
		}
		if(creep.memory.job === 'mine' && creep.carry.energy < creep.carryCapacity){
			const source: Source | null = Game.getObjectById(creep.memory.source);
			if(creep.inRangeTo(pos,0)) {
                if(source !== null){
                    if (source.energy){
                        creep.harvest(source);
                    }
                }
			}else{
				creep.travelTo(pos);
			}
		}

		if(creep.memory.job === 'mine' && creep.carry.energy >= 0){
			if(!creep.memory.containerId && creep.carry.energy > 30){
				const containers = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType === STRUCTURE_CONTAINER);

				if (!containers[0]){
					if (creep.room.memory.sources[creep.memory.source].container){
						delete creep.room.memory.sources[creep.memory.source].container;
					}
					const constructions = creep.room.lookForAt('constructionSite',pos.x,pos.y).filter((struct) => struct.structureType === STRUCTURE_CONTAINER);
					if (constructions[0] != null){
						creep.build(constructions[0]);
					} else{
						creep.room.createConstructionSite(pos.x,pos.y,STRUCTURE_CONTAINER);
					}
				}
				else{
					if (!creep.room.memory.sources[creep.memory.source].container){
						creep.room.memory.sources[creep.memory.source].container = true;
					}
					creep.memory.containerId = containers[0].id;
					creep.room.memory.sources[creep.memory.source].containerId = containers[0].id;
				}
			}else if(creep.carry.energy > 35 && creep.memory.containerId != null){
				const container: StructureContainer | null = Game.getObjectById(creep.memory.containerId);
				if(container){
    				if(!creep.inRangeTo(container,1)){
    					creep.travelTo(container);
    				}
    				else{
    				    if(container.hits < container.hitsMax-1000){
    				        creep.repair(container);
    				    }else{
    					    creep.transfer(container,RESOURCE_ENERGY);
    				    }
    				}
				}else{
				    delete creep.memory.containerId;
				}
			}
		}
	}

	public mineCancel(creep: Creep): void {
		if (creep.memory.job === 'mine'){
			this.idle(creep);
			creep.room.memory.sources[creep.memory.source].slotsUsed--;
		}
	}

	public salvage(creep: Creep): void {
		if (!creep.room.memory.underAttack && creep.memory.job === undefined && creep.carry.energy <= creep.carryCapacity/2){
			const salvage = creep.pos.findClosestByPath(creep.room.resources, {filter: (s: Resource) => s.amount > creep.carryCapacity && creep.room.name === s.pos.roomName});
			if (salvage != null){
				this.anounceJob(creep,'salvage');
				creep.memory.targetId = salvage.id;
			}
		}
		if(creep.memory.job === 'salvage' && creep.memory.targetId){
			const salvage : Resource | null = Game.getObjectById(creep.memory.targetId);
			if (salvage != null){
			    if(creep.inRangeTo(salvage,1)){
				    creep.pickup(salvage);
				}else{
					creep.travelTo(salvage);
				}
			}
			else{
				delete creep.memory.targetId;
			}
		}
		if(creep.memory.job === 'salvage' && (creep.room.memory.underAttack === true || !creep.memory.targetId || creep.carry.energy > 0)){
		this.idle(creep);
		}
	}

	public salvageCancel(creep: Creep): void {
		if(creep.memory.job === 'salvage'){
			this.idle(creep);
		}
	}

	public gather(creep: Creep): void {
		if (!creep.memory.job && creep.carry.energy < creep.carryCapacity){
			if(creep.ticksToLive !== undefined){
				if (creep.ticksToLive > 20){
					this.anounceJob(creep,'gather');
				}else{
					creep.suicide();
				}
			}

		}

		if (!creep.memory.containerId){
			if (creep.memory.role === 'hauler' && !creep.memory.containerId) {
				
				const pos = creep.room.memory.sources[creep.memory.source].containerPos;
				const containers = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType === STRUCTURE_CONTAINER);
				creep.memory.containerId = containers.filter((struct: Structure) => struct.pos.x === pos.x && struct.pos.y === pos.y)[0];
			}else{
				let noHaulContainer: Structure | null = null;
				if (creep.room.controller!.level<8 && creep.room.terminal && creep.room.terminal.store.energy > 51000){
					noHaulContainer = creep.room.terminal;
				} 
				if (!noHaulContainer && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > creep.carryCapacity){
					noHaulContainer = creep.room.storage;
				} 
				if (!noHaulContainer && creep.memory.role !== 'upgrader') {
					noHaulContainer = creep.pos.findClosestByPath(creep.room.containers, {filter: (s: StructureContainer) => s.store[RESOURCE_ENERGY] > creep.carryCapacity && creep.room.name === s.room.name})
				}
				if (noHaulContainer){
					creep.memory.containerId = noHaulContainer.id;
				}
			}
		}    
		const container: StructureContainer | StructureStorage | StructureTerminal | null = Game.getObjectById(creep.memory.containerId);
		if(creep.memory.job === 'gather' && container != null && creep.carry.energy < creep.carryCapacity){
			const salvage = container.room!.resources.filter( (s: Resource ) => container.pos.x === s.pos.x && container.pos.y === s.pos.y && creep.room.name === s.room!.name)[0];
			if (salvage !== undefined){
				if (creep.inRangeTo(salvage,1)){
					creep.pickup(salvage);
				}else{
					creep.travelTo(salvage);
				} 
			}else if (creep.inRangeTo(container,1)){
			    if(container.store.energy >= creep.carryCapacity-creep.carry.energy || container.store.energy >= 1000){
				    creep.withdraw(container,RESOURCE_ENERGY);
			    }
			}else{
				if(creep.memory.role !== 'upgrader'){
					creep.travelTo(container);
				}else{
					creep.moveTo(container);
				}
			}
		}
		if(creep.memory.job === 'gather' && (creep.carry.energy === creep.carryCapacity || creep.memory.containerId === null || container === null || container.store[RESOURCE_ENERGY] < creep.carryCapacity/4)){
			if (creep.memory.role !== 'hauler'){
				delete creep.memory.containerId;
			}
			this.idle(creep);
		}
	}

	public gatherCancel(creep: Creep): void {
		if(creep.memory.job === 'gather'){
			this.idle(creep);
		}
	}

	public build(creep: Creep): void {
		if((creep.carry.energy > 0)&&(!creep.memory.job)){
			let constructions: ConstructionSite[] = [];
			if(constructions.length === 0 && creep.room.controller!.level > 1) {
				constructions = creep.room.constructionSitesByType(STRUCTURE_EXTENSION);
			}
			if(constructions.length === 0) {
				constructions = creep.room.constructionSitesByType(STRUCTURE_CONTAINER);
			}
			if(constructions.length === 0) {
				constructions = creep.room.constructionSitesByType(STRUCTURE_STORAGE);
			}
			if(constructions.length === 0 && creep.room.controller!.level > 2) {
				constructions = creep.room.constructionSitesByType(STRUCTURE_TOWER);
			}
			if(constructions.length === 0) {
				constructions = creep.room.constructionSitesByType(STRUCTURE_ROAD);
			}
			if(constructions.length === 0) {
				constructions = creep.room.constructionSitesByType(STRUCTURE_WALL);
			}
			if(constructions.length === 0) {
				constructions = creep.room.constructionSites;
			}
			if(constructions.length > 0){
				this.anounceJob(creep,'build');
				const targetSite = creep.pos.findClosestByRange(constructions);
				if (!(targetSite === null || targetSite === undefined)) {
					creep.memory.tragetId = targetSite.id;
				}
			}
		}
		const target: ConstructionSite | null = Game.getObjectById(creep.memory.targetId);
		if(creep.carry.energy > 0 && creep.memory.job === 'build' && target != null){
		    if(creep.inRangeTo(target,1)){
		        creep.park();
    			if(creep.build(target) === ERR_INVALID_TARGET){
    				if (target.structureType === STRUCTURE_RAMPART){ 
    					this.idle(creep);
    					return this.repair(creep);
    				}
    				else if (target.structureType === STRUCTURE_WALL || target.structureType === STRUCTURE_ROAD){
    					this.idle(creep);
    					return this.build(creep);
    				}
    			}
		    }else{
		        creep.travelTo(target);
		    }
		}
		if((target == null || creep.carry.energy === 0) && creep.memory.job === 'build'){
		    creep.unpark();
			this.idle(creep);
		}
	}

	public buildCancel(creep: Creep): void {
		if(creep.memory.job === 'build'){
			this.idle(creep);
		}
	}

	public repair(creep: Creep): void {
	    const room: Room = creep.room;
		if(creep.carry.energy > 0 && !creep.memory.job){
			let repairTargets: Structure[] = creep.room.roads.filter((structure) => structure.hits < structure.hitsMax-1500);
			if(!repairTargets.length && creep.room.energyCapacityAvailable>=1300){
			    if(!room.memory.structureHitsMin){
			       room.memory.structureHitsMin = 5000; 
			    }
			    const minHits = room.memory.structureHitsMin;
    			if(!repairTargets.length){
    			    repairTargets = room.ramparts.filter((structure) => structure.hits < minHits);
    			}
    			if(!repairTargets.length){
    			    repairTargets = room.constructedWalls.filter((structure) => structure.hits < minHits);
    			}
    			if(!repairTargets.length && minHits < 15000000){
    			   room.memory.structureHitsMin += 1000; 
    			}
			}
			if(repairTargets.length > 0){
			    const repairTarget = creep.pos.findClosestByPath(repairTargets);
			    if(repairTarget){
    			    const type = repairTarget.structureType;
    			    if(type === STRUCTURE_RAMPART || type === STRUCTURE_WALL){
    			        room.memory.structureHitsMin = repairTarget.hits;
    			    }
    				this.anounceJob(creep,'repair');
    				creep.memory.targetId = repairTarget.id;
			    }
			}
		}
		const target: Structure | null = Game.getObjectById(creep.memory.targetId);
		if(creep.carry.energy > 0 && creep.memory.job ==='repair' && target != null && target.hits < target.hitsMax){
		    if(creep.inRangeTo(target,3)){
		        creep.park();
		        creep.repair(target);
		    }else{
				// creep.travelTo(target);
				creep.moveTo(target,{range:3,ignoreCreeps:true,reusePath:50}); // ignoreRoads:true
	    	}
		}
		if((target === null || creep.carry.energy === 0 || target.hits === target.hitsMax) && creep.memory.job === 'repair'){
		    creep.unpark();
			this.idle(creep);
		}
	}

	public repairCancel(creep: Creep): void {
		if(creep.memory.job === 'repair'){
			this.idle(creep);
		}
	}

	public haul(creep: Creep): void {
		const target: null | StructureContainer | StructureStorage | StructureSpawn | StructureExtension | StructureTower | StructureLink | StructureTerminal = Game.getObjectById(creep.memory.targetId);
		if (creep.memory.job === 'haul') {
			if(creep.carry.energy === 0 || target == null ) {
				this.idle(creep);
			} else if (target.structureType === STRUCTURE_CONTAINER || target.structureType === STRUCTURE_STORAGE) {
				if (target.store.energy === target.storeCapacity) {
					this.idle(creep);
				}
			} else if( target.structureType === STRUCTURE_LINK || target.structureType === STRUCTURE_SPAWN || target.structureType === STRUCTURE_TOWER ){
				if(target.energy === target.energyCapacity) {
					this.idle(creep);
				}
			}
		}
		if (!creep.memory.job && creep.carry.energy > 0){
			let targets: any[] = [];
			if (!targets.length){
				targets = creep.room.towers.filter((structure) => structure.energy < structure.energyCapacity-800);
			}
			if (!targets.length){
				targets = creep.room.spawns.filter((structure) => structure.energy < structure.energyCapacity);
			}
			if(!targets.length){
				targets = creep.room.extensions.filter((structure: StructureExtension) => structure.energy < structure.energyCapacity);
			}
			if (!targets.length && creep.room.terminal && creep.room.terminal.store.energy<50000){
			    targets = [creep.room.terminal];
			}
			if (!targets.length && creep.room.labs.length){
			    targets = creep.room.labs.filter((l)=>l.energy < 1000);
			}
			if (!targets.length && creep.room.powerSpawn && creep.room.powerSpawn.energy<creep.room.powerSpawn.energyCapacity){
			    targets = [creep.room.powerSpawn];
			}
			if (!targets.length && creep.room.nuker && creep.room.nuker!.energy < creep.room.nuker!.energyCapacity){
			    targets = [creep.room.nuker];
			}
			// if (creep.memory.role != 'supplier' && !targets.length && creep.carry.energy > 0 ){//creep.carryCapacity/4){
			if (!targets.length && creep.carry.energy > 0 ){// creep.carryCapacity/4){
				targets = creep.room.towers.filter((structure) => structure.energy < structure.energyCapacity-100);
			}
			if (creep.memory.role === 'hauler' && !targets.length && creep.carry.energy > 0 ){// creep.carryCapacity/4){
				targets = [creep.room.storage].filter( (structure) => structure && structure.store.energy < structure.storeCapacity && creep.room.name === structure.room.name);
			}
			if (targets.length){
				const newtarget = creep.pos.findClosestByPath(targets);
				if (newtarget){
					creep.memory.targetId = newtarget!.id;
					this.anounceJob(creep,'haul');
				} else{
					this.relax(creep);
				}
			}
		}
		if (creep.memory.job === 'haul' && creep.carry.energy > 0){
			const targetA: null | any = Game.getObjectById(creep.memory.targetId);
			if(targetA !== null){
				if (targetA.structureType === STRUCTURE_STORAGE || targetA.structureType === STRUCTURE_TERMINAL){
					if (targetA.store.energy < targetA.storeCapacity && creep.inRangeTo(targetA,1)){
						creep.transfer(targetA, RESOURCE_ENERGY);
					}else{
						creep.travelTo(targetA);
					}
				}else {
					if (targetA.energy < targetA.energyCapacity && creep.inRangeTo(targetA,1)){
						creep.transfer(targetA, RESOURCE_ENERGY);
					}else{
						creep.travelTo(targetA);
					}
				}
			}

		}
	}

	public haulCancel(creep: Creep): void{
		if(creep.memory.job === 'haul'){
			this.idle(creep);
		}
	}

	public upgrade(creep: Creep): void{
		if (creep.carry.energy > 0){
			if (!creep.memory.job){
				this.anounceJob(creep,'upgrade');
				creep.memory.targetId=creep.room.controller!.id;
			}
			if (creep.memory.job === 'upgrade'){
				const target: StructureController | null = Game.getObjectById(creep.memory.targetId);
				if(target !== null) {
					const rangeTo = creep.pos.getRangeTo(target);
					switch(rangeTo){
						case 3:
							creep.travelTo(target);
						case 1:
							creep.upgradeController(target);
							break;
						default:
	
							creep.travelTo(target);
					}
				}
			}
		} 
		if((creep.carry.energy === 0 || (creep.memory.workModules && creep.carry.energy < creep.memory.workModules) ) && creep.memory.job === 'upgrade'){
			if (!(!creep.memory.cFlagId)){
				delete creep.memory.cFlagId;
			}
			creep.unpark();
			this.idle(creep);
		}
	}

	public upgradeCancel(creep: Creep): void{
		if(creep.memory.job === 'upgrade'){
			this.idle(creep);
		}
	}

	public recharge(creep: Creep): void{
		if (creep.carry.energy > 0){
			if (!creep.memory.job){
				this.anounceJob(creep,'recharge');
				creep.memory.targetId = creep.room.controller!.id;
				const controllerFlag: Flag[] = _.filter(Game.flags, (flag) => flag.name === 'Controller' && flag.pos.roomName === creep.room.name);
				if (controllerFlag[0] !== null){
					creep.memory.cFlagId = controllerFlag[0].name;
				}
			}
			if (creep.memory.job === 'recharge'){
				const target: StructureController | null = Game.getObjectById(creep.memory.targetId);
				if(target !== null ){
					if(creep.generateSafeMode(target) === ERR_NOT_IN_RANGE) {
						if(creep.memory.cFlag){
							creep.travelTo(Game.flags.Controller);
						}
						else{
							creep.travelTo(target);
						}
					}
				}
			}
		} 
		if(creep.carry.energy === 0 && creep.memory.job === 'upgrade'){
		if (!(!creep.memory.cFlagId)){
		delete creep.memory.cFlagId;
		}
		this.idle(creep);
		}
	}

	public rechargeCancel(creep: Creep): void{
		if(creep.memory.job === 'recharge'){
			this.idle(creep);
		}
	}

	public defend(creep: Creep): void{
		const WHITELIST: {[name: string]: boolean} = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};
		let closestHostile: Creep | null = creep.pos.findClosestByRange(creep.room.hostileCreeps,{filter: (hostile: Creep) => 
			(WHITELIST[hostile.owner.username] === undefined) 
			&& (hostile.pos.x > 0 && hostile.pos.y > 0 && hostile.pos.x < 49 && hostile.pos.y < 49 )
			&& (hostile.body.filter((body) => body.type === 'attack' || body.type === 'ranged_attack' || body.type === 'claim').length > 0) 
		}
		);
		if (!closestHostile) {
			closestHostile = creep.pos.findClosestByRange(creep.room.hostileCreeps,{filter: (hostile: Creep) =>
				WHITELIST[hostile.owner.username] === undefined 
				&& hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
				&& hostile.body.filter((body) => body.type === 'claim' || body.type === 'work').length > 0
			});
		} 
		if(closestHostile){
			if(creep.attack(closestHostile) === ERR_NOT_IN_RANGE){
				creep.travelTo(closestHostile);
				creep.say('DEFENSE !!!');
			}
		}
	}
	
	public travel(creep: Creep, targetId: string): boolean{
		if (targetId){
			const destination: RoomObject | null= Game.getObjectById(targetId);
			if(destination){
				if (!creep.pos.inRangeTo(destination,1)){
					creep.travelTo(destination);
					return true;
				}else{
					return false;
				}
			}
        }
        return false;
	}
	
	public anounceJob(creep: Creep,job: string){
		if(job){
			creep.memory.job=job;
			creep.say(job);
		}else{
			this.idle(creep);
		}
	}

	public relax(creep: Creep): void{
		if (creep.pos.x > 2 && creep.pos.x < 48 && creep.pos.y > 2 && creep.pos.y < 48) {
			creep.move(  (Game.time % 8) as DirectionConstant);
		}
	}

	public idle(creep: Creep): void{
		creep.say("idle")
		if (creep.memory.targetId){
			delete creep.memory.targetId;
		}
		if (creep.memory.job){
			delete creep.memory.job;
		}
	}

    
    public buildSourceRoads(spawn: StructureSpawn): void {
        for (const i in spawn.room.memory.sources){
            const source: Source | null = Game.getObjectById(i); 
            const path = spawn.room.findPath(source!.pos,source!.room.controller!.pos);
            const pathArray: PathStep[] = Room.deserializePath(Room.serializePath(path));
            for(const j of pathArray){
                source!.room.createConstructionSite(j.x, j.y,STRUCTURE_ROAD);
            }
        }
    }

    public buildSwampRoads(spawn: StructureSpawn): void {
        for (const i in spawn.room.memory.sources){
            const source: Source | null = Game.getObjectById(i); 
            const path = spawn.room.findPath(source!.pos,source!.room.controller!.pos);
            const pathArray: PathStep[] = Room.deserializePath(Room.serializePath(path));
            for(const j of pathArray){
                if (spawn.room.lookForAt<LOOK_TERRAIN>(LOOK_TERRAIN ,j.x, j.y)[0] === "swamp" ) {
                    spawn.room.createConstructionSite(j.x, j.y,STRUCTURE_ROAD);
                }
            }
        }
    }

    public roomProfiler(spawn: StructureSpawn) {
        const room: string = spawn.room.name;
        if(!Memory.rooms[room].stats){
            Memory.rooms[room].stats={};
        }else{
            if(!Memory.rooms[room].stats.spawns){
                Memory.rooms[room].stats.spawns ={};
            }else{
                if(!Memory.rooms[room].stats.spawns[spawn.name]){
                    Memory.rooms[room].stats.spawns[spawn.name] = {};
                }
            }
        }

        if(Game.time % 1000 === 0){
            Memory.rooms[room].stats.spawns[spawn.name].utilization=Memory.rooms[room].stats.spawns[spawn.name].ticks_s/1000;
            Memory.rooms[room].stats.spawns[spawn.name].ticks_s=0;
            Memory.rooms[room].stats.spawns[spawn.name].waitingForEnergy=Memory.rooms[room].stats.spawns[spawn.name].ticks_e/1000;
            Memory.rooms[room].stats.spawns[spawn.name].ticks_e=0;
        }else{
        if(spawn.spawning != null){
            Memory.rooms[room].stats.spawns[spawn.name].ticks_s=Memory.rooms[room].stats.spawns[spawn.name].ticks_s+1;
            }else if(spawn.room.energyAvailable < spawn.room.energyCapacityAvailable){
                Memory.rooms[room].stats.spawns[spawn.name].ticks_e=Memory.rooms[room].stats.spawns[spawn.name].ticks_e+1;
            }
        }
    }
}