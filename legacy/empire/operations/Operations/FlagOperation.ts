import { OperationsManager } from "empire/OperationsManager";
import { RemoteOperation, RemoteOperationData, RemoteOperationProto } from "./RemoteOperation";

export interface FlagOperationProto extends RemoteOperationProto {
    data: FlagOperationData;
}

export interface FlagOperationData extends RemoteOperationData {
    [id: string]: any;
    flag: string;
}


export class FlagOperation extends RemoteOperation {
    public flag: Flag;
    public targetRoomName: string;
    constructor(name: string, manager: OperationsManager, entry: FlagOperationProto) {
        super(name,manager,entry);
        this.flag = Game.flags[entry.data.flag];
        this.targetRoomName = this.needsMoving() ? this.flag.memory. moveTo.roomName : this.flag.pos.roomName;
        
    }

    private needsMoving(): boolean {
        if(this.flag.memory.moveTo){
            if(this.flag.memory.moveTo.roomName === this.flag.pos.roomName){
                false;
            }
            return true;
        }
        return false;
    }

    private moveFlag(): void {
        if(Game.rooms[this.targetRoomName]){
            if(this.flag.setPosition(new RoomPosition(this.flag.memory.moveTo.x, this.flag.memory.moveTo.y, this.targetRoomName)) == OK){
                delete this.flag.memory.moveTo;
            }
        }
    }

    public run() {
        if(!this.flag || !this.parentExists()){
            this.removeSelf();
        }
        console.log("This needs moving: " + this.needsMoving());
        if(this.needsMoving()){
            this.moveFlag();
        }
        super.run();


    }
    public parentExists(): boolean {
        if(this.flag.memory.parent){
            return this.manager.entryExists(this.flag.memory.parent);
        }
        return false;
    }

    public removeSelf(): void {
        super.removeSelf();
        console.log("Removed FlagOperation: " + this.name + " in Room: " + this.data.targetRoom + " with base: " + this.data.roomName);
        if(this.flag != null){
            this.flag.remove();
        }
        
    }

    public findnearestRoom(): string | null{
        console.log("FindNearestRoom");
        if(this.data.nearestSpawn == null ){
            const targetRoom = this.flag.pos.roomName;
            const roomWithSpawns = Object.entries(Game.rooms).filter(
                (entry) => entry[1].controller != null && entry[1].controller!.my
            ).filter( entry =>  entry[1].find(FIND_MY_SPAWNS).filter( spawn => spawn.room.energyCapacityAvailable >= 2400
            ).length > 0);
            const sorted = roomWithSpawns.sort( (entryA,entryB) => {
                const routeA =Game.map.findRoute(targetRoom, entryA[1]);
                const routeB = Game.map.findRoute(targetRoom, entryB[1]);
                if(routeA !== ERR_NO_PATH && routeB !== ERR_NO_PATH){
                    return (routeA.length - routeB.length);
                }else {
                    return 50;
                }}   )
            const shortest = sorted.shift();
            if(shortest != null){
                this.data.nearestSpawn = shortest[1].name; 
                return shortest[1].name;
            } else {
                return null;
            }
        } else {
            return this.data.nearestSpawn;
        }
    }
}