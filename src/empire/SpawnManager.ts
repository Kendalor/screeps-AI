import { EmpireManager } from "empire/EmpireManager";
import { Attacker } from "./creeps/roles/Attacker";
import { Builder } from "./creeps/roles/Builder";
import { Claimer } from "./creeps/roles/Claimer";
import { Colonize } from "./creeps/roles/Colonize";
import { HaulDeposit} from "./creeps/roles/HaulDeposit";
import { Hauler } from "./creeps/roles/Hauler";
import { Healer } from "./creeps/roles/Healer";
import { Logistic } from "./creeps/roles/Logistic";
import {Maintenance} from "./creeps/roles/Maintenance";
import { MineDeposit } from "./creeps/roles/MineDeposit";
import { Miner } from "./creeps/roles/Miner";
import { MineralMiner } from "./creeps/roles/MineralMiner";
import { RemoveInvader } from "./creeps/roles/RemoveInvader";
import { Repairer } from "./creeps/roles/Repairer";
import { Supply } from "./creeps/roles/Supply";
import { Upgrader } from "./creeps/roles/Upgrader";
import { SpawnEntry} from "./spawn/SpawnEntry";
/**
 * Manages Spawning. Has a List of Creeps to Spawn which is kept in Memory and loaded on Initializations.
 * If spawns are available, it goes through its toSpawnList, filters spawnable creeps and spawns the one with the highest priority. 
 * If Creeps with rebuild=true are in the List, Creep stays in the toSpawn List and the pause timer is set to 1500.
 * On saveList(), the toSpawnList is saved to Memory and all pause timers are decreased by 1. 
 * 
 * 
 * 
 */

export class SpawnManager {
    public availableSpawns: StructureSpawn[] = [];
    public empire: EmpireManager;
    public toSpawnList: {[name: string]: SpawnEntry} = {};
    public roles: any = {Logistic, Maintenance, Miner, Upgrader, Supply, Builder, Repairer, Attacker, Claimer, Colonize, Hauler,RemoveInvader, MineralMiner, HaulDeposit,MineDeposit, Healer };


    constructor(empire: EmpireManager) {
        this.empire = empire;
        if(Memory.empire.toSpawnList == null){
            Memory.empire.toSpawnList = {};
        }

    }

    public init(): void {
        this.availableSpawns = [];
        for(const j of Object.keys(Game.spawns)){
            if(Game.spawns[j].spawning === null && Game.spawns[j].isActive()){
                this.availableSpawns.push(Game.spawns[j]);
            }
        }
    }
    
    public purge(): void {
        this.toSpawnList = {};
    }

    public destroy(): void {
        this.refreshSpawnList();
    }

    /**
     * SpawmManger run function: For each Spawn in availableSpawns, tries to spawn the next spawnable creep with highest priority.
     */
    public run(){
        const toSpawn = Object.entries(this.toSpawnList).filter( a => a[1].pause === 0).sort( (a,b) => a[1].priority - b[1].priority);
        // console.log("ToSpawn Lenght: " + toSpawn.length);
        for(const spawn of this.availableSpawns){
            const roomEntries = toSpawn.filter( entry => entry[1].room === spawn.room.name);
            // console.log("Room Entries: " + roomEntries.length);
            if(roomEntries != null && roomEntries.length >0 ){
                
                const entry = roomEntries.pop();
                // console.log("Spawn RoomEntry: " + JSON.stringify(entry));
                if(entry != null){
                    if(entry[1].op != null && this.empire.opMgr.entryExists(entry[1].op)){
                        try {
                            const body: BodyPartConstant[] = (entry[1].body != null) ? entry[1].body : this.roles[entry[1].memory.role].getBody(spawn);
                            let direction: DirectionConstant | null = null;
                            // console.log("Trying to Spawn: " + JSON.stringify(entry[1]));

                            const mem = JSON.parse(JSON.stringify(entry[1].memory)); // DEEP Copy 
                            const err: ScreepsReturnCode = spawn.spawnCreep(body, entry[0], {memory: mem, dryRun: true});
                            // console.log("Return Code: " +err );
                            if(err === OK ){
                                if( entry[1].toPos != null ){
                                    const pos = entry[1].toPos as RoomPosition;
                                    direction = spawn.pos.getDirectionTo(pos);
                                } else {
                                    if(spawn.room.memory.base != null){
                                        if(spawn.room.memory.base.anchor != null){
                                            const roads = spawn.pos.findInRange(FIND_STRUCTURES,1).filter( str => str.structureType === STRUCTURE_ROAD);
                                            if(roads.length > 0){
                                                const road = roads.pop();
                                                if(road != null){
                                                    direction = spawn.pos.getDirectionTo(road);
                                                }
                                            }
                                        }
                                    }
                                }
                                if(direction == null){
                                    spawn.spawnCreep(body, entry[0], {memory: mem, dryRun: false});
                                } else {
                                    spawn.spawnCreep(body, entry[0], {memory: mem, dryRun: false, directions: [direction]});
                                }
                                
                                if(entry[1].rebuild === true) {
                                    entry[1].pause = 1500;
                                } else {
                                    this.dequeueByName(entry[0]);
                                }
                            } else if(err === ERR_INVALID_ARGS){
                                this.dequeueByName(entry[0]);
                            } else if(err === ERR_NAME_EXISTS){
                                this.dequeueByName(entry[0]);
                            }
                            else if(err === ERR_NOT_ENOUGH_ENERGY){
                                // console.log("Not enough energy to spawn:" + spawn.room.name);
                                if(spawn.room.energyAvailable === spawn.room.energyCapacityAvailable){
                                    // console.log("Room at Max energy:" + spawn.room.name);
                                    this.dequeueByName(entry[0]);
                                }
                                
                            } else {
                                console.log ("Returned " + err);
                            }
                        } catch (error) {
                            // console.log("ERROR: for " + entry[1].memory.role + " ERR: " + error + " DELETING ENTRY: ");
                            // console.log(JSON.stringify(entry));
                            // console.log(JSON.stringify(error));
                            this.dequeueByName(entry[0]);
                        }
                    } else {
                        this.dequeueByName(entry[0]);
                        // console.log("DequeuedByName because of missing op: " + entry[0]);
                    }


                }
            }
        }  
    }

    public containsEntry(name: string){
        return this.toSpawnList[name] != null;
    }

    public generateName(): string {
        return Math.random().toString(36).substr(4);
    }
    /**
     * push a new SpawnEntry into the toSpawnList of the SpawnManager
     * @param entry SpawnEntryMemory
     */
    public enque(entry: SpawnEntryMemory): string {
        const name = this.generateName();
        global.logger.debug("Enque Creep: " + name);
        this.toSpawnList[name]=new SpawnEntry(entry);
        return name;
    }

    public spawnAvailable(): boolean {
        return this.availableSpawns.length > 0;
    }
    /**
     * remove a  SpawnEntry from the toSpawnList by name of Creep
     * @param name String
     */
    public dequeueByName(name: string){
        delete this.toSpawnList[name];
    }

    /**
     * remove a new SpawnEntry from the toSpawnList of the SpawnManager
     * @param entry SpawnEntryMemory
     */
    public dequeueByEntry(entry: SpawnEntry){
        for(const e of Object.keys(this.toSpawnList)){
            if(this.toSpawnList[e].equals(entry)){
                delete this.toSpawnList[e];
            }
        }
    }

    public getCost(body: BodyPartConstant[]): number {
        let cost: number = 0;
        for(const part of body){
            cost=cost + BODYPART_COST[part];
        }
        return cost;
    }

    /**
     *  save toSpawnList to Memory
     */
    public refreshSpawnList(){
        for(const entry of Object.keys( this.toSpawnList)) {
            if(this.toSpawnList[entry].pause > 0){
                this.toSpawnList[entry].pause--;
            }
        }
    }
}