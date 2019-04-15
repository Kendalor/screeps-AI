import { RoomManager } from "../RoomManager";
import { SpawnEntry, SpawnEntryMemory } from "./SpawnEntry";


/**
 * Manages Spawning in one room. Has a List of Creeps to Spawn which is kept in Memory and loaded on Initializations.
 * If spawns are available, it goes through its toSpawnList, filters spawnable creeps and spawns the one with the highest priority. 
 * If Creeps with rebuild=true are in the List, Creep stays in the toSpawn List and the pause timer is set to 1500.
 * On saveList(), the toSpawnList is saved to Memory and all pause timers are decreased by 1. 
 * 
 * 
 * FUTURE TODO: Push this to the Empire Level 
 */

export class SpawnManager {
    public room: Room;
    public roomName: string;
    public availableSpawns: StructureSpawn[];
    public manager: RoomManager;


    constructor(mgr: RoomManager, roomName: string) {
        this.manager = mgr;
        this.roomName=roomName;
        this.room = Game.rooms[roomName];
        if(this.room !== undefined ){
            this.availableSpawns = this.room.find(FIND_MY_SPAWNS).filter((entry: StructureSpawn) => (entry.isActive && entry.spawning === null ));
        } else {
            this.availableSpawns = [];
        }
    }


/**
 * SpawmManger run function: For each Spawn in availableSpawns, tries to spawn the next spawnable creep with highest priority.
 */
    public run(){
        this.spawnNext();
    }

    /**
     * push a new SpawnEntry into the toSpawnList of the SpawnManager
     * @param entry SpawnEntryMemory
     */
    public enque(entry: SpawnEntryMemory){
        this.manager.data.toSpawnList.push(new SpawnEntry(entry));
    }

    public spawnAvailable(): boolean {
        return this.availableSpawns.length > 0;
    }
/**
 * remove a new SpawnEntry from the toSpawnList of the SpawnManager
 * @param entry SpawnEntryMemory
 */
    public dequeue(entry: SpawnEntryMemory){
        _.remove(this.manager.data.toSpawnList, (e) => { return (e.body === entry.body && e.memory === entry.memory && e.name === entry.name && e.rebuild === e.rebuild) 
        });
    }
/**
 * Spawn the next spawnable Creep in the toSpawnList with the highest Priority, indrement wait on success and deque otherwise
 */
    public spawnNext() {
        if(this.spawnAvailable()) {
            const entry: SpawnEntry | undefined = this.manager.data.toSpawnList.filter( (e) => e.getCost() < this.room.energyAvailable && e.pause === 0 ).sort((a,b) => a.priority - b.priority ).pop();
            if(entry !== undefined ){
                for(const spawn of this.availableSpawns){
                    // Validate Name
                    if(Game.creeps[entry.name] !== undefined ){
                        entry.name = entry.name + "_" + String(Game.time % 1000);
                    }
                    const err: ScreepsReturnCode = spawn.spawnCreep(entry.body, entry.name, {memory: entry.memory, dryRun: true});
                    if(err === OK ){
                        spawn.spawnCreep(entry.body, entry.name, {memory: entry.memory, dryRun: false});
                        if(entry.rebuild === true) {
                            entry.pause = entry.body.length * 3 + 1500;
                        } else {
                            this.dequeue(entry as SpawnEntryMemory);
                        }
                    }
                }
            }
        }
    }
}