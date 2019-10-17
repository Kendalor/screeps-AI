import { EmpireManager } from "empire/EmpireManager";
import { Builder } from "./creeps/roles/Builder";
import {Maintenance} from "./creeps/roles/Maintenance";
import { Miner } from "./creeps/roles/Miner";
import { Repairer } from "./creeps/roles/Repairer";
import { Supply } from "./creeps/roles/Supply";
import { Upgrader } from "./creeps/roles/Upgrader";
import { SpawnEntry, SpawnEntryMemory } from "./spawn/SpawnEntry";

/**
 * Manages Spawning. Has a List of Creeps to Spawn which is kept in Memory and loaded on Initializations.
 * If spawns are available, it goes through its toSpawnList, filters spawnable creeps and spawns the one with the highest priority. 
 * If Creeps with rebuild=true are in the List, Creep stays in the toSpawn List and the pause timer is set to 1500.
 * On saveList(), the toSpawnList is saved to Memory and all pause timers are decreased by 1. 
 * 
 * 
 * FUTURE TODO: Push this to the Empire Level 
 */

export class SpawnManager {
    public availableSpawns: StructureSpawn[] = [];
    public empire: EmpireManager;
    public toSpawnList: {[name: string]: SpawnEntry} = {};
    public roles: any = {Maintenance, Miner, Upgrader, Supply, Builder, Repairer};


    constructor(empire: EmpireManager) {
        this.empire = empire;

        if(Memory.empire == null ){
            Memory.empire = {};
        }
        if(Memory.empire.toSpawnList == null){
            Memory.empire.toSpawnList = {};
        }

    }

    public init(): void {
        this.loadSpawnList();
        this.availableSpawns = [];
        for(const j of Object.keys(Game.spawns)){
            if(Game.spawns[j].spawning === null && Game.spawns[j].isActive()){
                this.availableSpawns.push(Game.spawns[j]);
            }
        }
    }

    public destroy(): void {
        this.saveSpawnList();
    }

    /**
     * SpawmManger run function: For each Spawn in availableSpawns, tries to spawn the next spawnable creep with highest priority.
     */
    public run(){
        const toSpawn = Object.entries(this.toSpawnList).filter( a => a[1].pause === 0).sort( (a,b) => a[1].priority - b[1].priority);
        for(const spawn of this.availableSpawns){
            const roomEntries = toSpawn.filter( entry => entry[1].room === spawn.room.name);
            if(roomEntries != null && roomEntries.length >0 ){
                const entry = roomEntries.pop();
                if(entry != null){
                    const body: BodyPartConstant[] = (entry[1].body != null) ? entry[1].body : this.roles[entry[1].memory.role].getBody(spawn);
                    const err: ScreepsReturnCode = spawn.spawnCreep(body, entry[0], {memory: entry[1].memory, dryRun: true});
                    if(err === OK ){
                        spawn.spawnCreep(body, entry[0], {memory: entry[1].memory, dryRun: false});
                        if(entry[1].rebuild === true) {
                            entry[1].pause = 1500;
                        } else {
                            this.dequeueByName(entry[0]);
                        }
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

    public loadSpawnList(){
        this.toSpawnList={};
        global.logger.debug("Loading Spawnlist of Length: " + Object.keys(Memory.empire.toSpawnList));
        for(const i of Object.keys(Memory.empire.toSpawnList)) {
            this.toSpawnList[i] = new SpawnEntry(Memory.empire.toSpawnList[i] as SpawnEntryMemory);
        }
        global.logger.debug("Loaded Spawnlist of Length: " + Object.keys(this.toSpawnList));
    }

    /**
     *  save toSpawnList to Memory
     */
    public saveSpawnList(){
        Memory.empire.toSpawnList = {};
        global.logger.debug("Saving Spawnlist of Length: " + Object.keys(this.toSpawnList).length);
        for(const entry of Object.keys( this.toSpawnList)) {
            if(this.toSpawnList[entry].pause > 0){
                this.toSpawnList[entry].pause--;
            }
            Memory.empire.toSpawnList[entry]=this.toSpawnList[entry].toMemory() as SpawnEntryMemory;
        }
        global.logger.debug("Saved Spawnlist of Length: " + Object.keys(Memory.empire.toSpawnList).length);

    }
}