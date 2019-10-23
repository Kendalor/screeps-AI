import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";

export class FlagOperation extends Operation {
    public flag: Flag;
    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.flag = Game.flags[entry.data.flag];
    }

    public run() {
        super.run();

        if(this.flag == null){
            this.lastRun=true;
        }
        if(this.lastRun === true) {
            if(this.flag != null) {
                this.flag.remove();
            }
        }
    }

    public findnearestRoom(): string | null{
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
            const shortest = sorted.pop();
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