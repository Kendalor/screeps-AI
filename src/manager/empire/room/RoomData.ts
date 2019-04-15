import { RoomDataInterface } from "./RoomDataInterface";
import { RoomManager } from "./RoomManager";
import { RoomOperation } from "./RoomOperations/RoomOperation";
import { RoomOperationInterface } from "./RoomOperations/RoomOperationInterface";
import { RoomOperationMemoryInterface } from "./RoomOperations/RoomOperationMemoryInterface";
import { OP_STORAGE } from "./RoomOperations/RoomOperationStorage";
import { SpawnEntry, SpawnEntryMemory } from "./spawn/SpawnEntry";

export class RoomData implements RoomDataInterface {
    public mine: boolean = false;
    public operations: RoomOperation[] = [];
    public toSpawnList: SpawnEntry[] = [];
    public roomName: string;
    public manager: RoomManager;

    constructor(manager: RoomManager){
        this.manager = manager;
        this.roomName = this.manager.roomName;
        if(Memory.rooms[this.roomName] === undefined) {

            console.log("Memory.rooms.roomName is undefined");
            Memory.rooms[this.roomName] = {} as RoomDataInterface;
            if(Game.rooms.roomName === undefined) {
                this.mine = false;
            } else {
                if(Game.rooms.roomName.controller === undefined) {
                    this.mine = false;
                } else {
                    if(Game.rooms.roomName.controller.my) {
                        this.mine = true;
                    } else {
                        this.mine = false;
                    }
                }
            }
        } else {
            this.init();

        }

    }
/**
 * Load Operations and toSpawnlist From Memory
 */

    public init(): void {
        console.log("Init Room Data");
        this.mine = Memory.rooms[this.roomName].mine
        this.loadOperationList();
        this.loadSpawnList();
        console.log("Loaded " + this.operations.length + " Operations");
    }


    public toMemory(): any {
        return {mine: this.mine, roomName: this.roomName, operations: []}
    }
/**
 * Load Operations from Memory
 */
    public loadOperationList(): void {

        for(const i in Memory.rooms[this.roomName].operations) {
            this.operations.push(new OP_STORAGE[Memory.rooms[this.roomName].operations[i].type](this.manager, Memory.rooms[this.roomName].operations[i] as RoomOperationInterface));
        }
    }
/**
 * Save Operations to Memory
 */
    public saveOperationList(): void {
        console.log("Saving Operations to Memory");
        Memory.rooms[this.roomName].operations = [];
        console.log("Resetted Operations Memory:" + Memory.rooms[this.roomName].operations.length)
        for(const entry of this.operations) {
            if(entry.lastRun === false){
                if(entry.pause > 0){
                    entry.pause = entry.pause -1;
                }
                Memory.rooms[this.roomName].operations.push(entry.toMemory(
                ));
            }
        }
    }
    /**
     * push a new RoomOperation into the operations List of the RoomManager
     * @param entry RoomOperation
     */
    public enque(entry: RoomOperationMemoryInterface){
        this.operations.push(new OP_STORAGE[entry.type](this, entry as RoomOperationMemoryInterface));
    }
/**
 * remove a new RoomOperation from the operations List of the RoomManager
 * @param entry RoomOperationMemoryInterface
 */
    public dequeue(entry: RoomOperationMemoryInterface){
        _.remove(this.operations, (e) => { return (e.type === entry.type && e.name === entry.name) 
        });
    }
    /**
     * Load toSpawnList from Memory
     */

    public loadSpawnList(){
        for(const i in Memory.rooms[this.roomName].memory.spawnList) {
            this.toSpawnList.push(new SpawnEntry(Memory.rooms[this.roomName].memory.toSpawnList[i] as SpawnEntryMemory));
        }
    }
/**
 *  save toSpawnList to Memory
 */
    public saveSpawnList(){
        Memory.rooms[this.roomName].toSpawnList = [];
        for(const entry of this.toSpawnList) {
            if(entry.pause > 0){
                entry.pause = entry.pause -1;
            }
            Memory.rooms[this.roomName].toSpawnList.push(entry as SpawnEntryMemory);
        }
    }






    public destroy(): void {
        this.save();
    }

    public save(): void{
        Memory.rooms[this.roomName] = this.toMemory();
        this.saveOperationList();
        this.saveSpawnList()
        console.log("Saved "+ Memory.rooms[this.roomName].operations.length + " operations");
    }

}