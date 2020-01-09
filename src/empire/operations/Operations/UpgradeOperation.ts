import { OperationsManager } from "empire/OperationsManager";
import { InitialRoomOperation } from "./InitialBuildUpPhase/InitRoomOperation";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";
import { RoomPlannerOperation } from "./roomPlanner/RoomPlannerOperation";


export class UpgradeOperation extends RoomOperation{

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "UpgradeOperation";
    }

    public run() {
        super.run();
        this.checkParent();
        if(this.parent == null){
            this.removeSelf();
        }



        const r: Room = this.room;
        if(r != null){
            if( r.storage != null ){

                this.validateCreeps();
                const currentUpgraders = this.data.creeps.length;



                const numToSpawn = this.getMaxUpgraders(r);

                if(numToSpawn > currentUpgraders){
                    for(let j=currentUpgraders; j< numToSpawn ; j++){
                        const name = this.manager.empire.spawnMgr.enque({
                            room: r.name,
                            memory: {role: "Upgrader", op: this.name},
                            pause: 0,
                            body: undefined,
                            priority: 50,
                            rebuild: false});
                        this.data.creeps.push(name);
                    }
                }
            }
        }


    }

    public getBuildingList(): BuildEntry[] {
        const out = super.getBuildingList();
        if(this.room.controller != null){
            if(this.room.controller.my != null){
                if(this.room.storage != null){
                    const baseOp = this.manager.getEntryByName<InitialRoomOperation>(this.data.parent);
                    if(baseOp != null){
                        const roomPlanner: RoomPlannerOperation = baseOp.getRoomPlannerOperation();
                        if(this.room.storage.pos.getRangeTo(this.room.controller) > 4){
                            const path = roomPlanner.getPath(this.room.storage.pos,{pos: this.room.controller.pos, range: 1});
                            if(path.path.length > 0){
                                for(let i =1; i<= path.path.length-1; i++){
                                    out.push({x: path.path[i].x,y: path.path[i].y, type: STRUCTURE_ROAD});
                                }
                                const entry = this.getLinkPosFromPath(path);
                                if(entry != null){
                                    out.push(entry);
                                }
                            }

                        }

                    }
                }
            }
        }
        return out;
    }

    private getLinkPosFromPath(path: PathFinderPath): BuildEntry | null {
        const lastPathTile = new RoomPosition(path.path[path.path.length-1].x,path.path[path.path.length-1].y, path.path[path.path.length-2].roomName);
        let perimeter = this.room.lookForAtArea(LOOK_TERRAIN,lastPathTile.y-1, lastPathTile.x-1, lastPathTile.y+1,lastPathTile.x+1,true);
        perimeter = perimeter.filter ( t => t.terrain !== 'wall' );
        perimeter = perimeter.filter(t =>  path.path.filter( p => p.x === t.x && p.y === t.y).length === 0);
        const linkPos = perimeter.pop(); 
        if(linkPos != null){
            return {x: linkPos.x, y: linkPos.y, type: STRUCTURE_LINK};
        }
        return null;
    }


    public getMaxUpgraders(r: Room): number {
        if(r.controller != null){
            if(r.controller.my != null){
                if(r.controller.level === 8){
                    return 1;
                } else {
                    if(r.storage != null){
                        if(r.controller.ticksToDowngrade <= 5000){
                            return 1;
                        } else {
                            if(r.controller.ticksToDowngrade <= 5000){
                                return 1;
                            }
                        }
                        return Math.min(4, Math.max(0, Math.floor((r.storage.store.energy - 100000)/40000)));
                    }
                }
            }
        }
        return 0;
    }
}