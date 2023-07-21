import { OperationsManager } from "empire/OperationsManager";
import { InitialRoomOperation } from "../Operations/InitialBuildUpPhase/InitRoomOperation";

import { RoomOperation, RoomOperationProto } from "../Operations/RoomOperation";



export class MinerOperation extends RoomOperation{
    private baseOp: IInitialRoomOperation;

    

    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.MINING;
        let baseOp = Empire.getBaseOps().filter( op => op.name == this.parent).shift();
        if(!baseOp){
            throw Error("NO BASE OP FOUND FOR: " +this.name + " at Room: " + this.room.name);
        }
        this.baseOp = baseOp;
    }

    public run() {
        super.run()
        this.enqueueCreeps();

    }

    private getSources(): Source[] {
        return this.room.find(FIND_SOURCES);
    }

    private setCreepsLength(): void {
        if(this.room.controller != null){
            if(this.room.controller.level >= 7){
                this.data.maxCreeps = 1;
            } else {
                this.data.maxCreeps = 2;
            }
        }

    }

    private enqueueCreeps(): void {
        this.validateCreeps();
        this.setCreepsLength();
        if(this.data.maxCreeps === 2){
            if(this.data.creeps.length < this.data.maxCreeps ){
                const sources = this.getSources();
                const b = this.getMinerBody();
                for(const s of sources){
                    console.log("enqued Creep for: " + s.id);
                    const name = this.manager.empire.spawnMgr.enque({
                        body: b,
                        room: this.room.name,
                        memory: {role: "Miner", sourceId: [s.id], op: this.name},
                        pause: 0,
                        priority: 95,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            }
        } else if(this.data.maxCreeps === 1){
            if(this.data.creeps.length < this.data.maxCreeps ){
                const sources = this.getSources();
                const ids: Array<Id<Source>> = [];
                for(const s of sources){
                    ids.push(s.id);
                }
                const b = this.getMinerBody();
                console.log("Body: " + JSON.stringify(b));
                const name = this.manager.empire.spawnMgr.enque({
                    body: b,
                    room: this.room.name,
                    memory: {role: "Miner", sourceId: ids, op: this.name},
                    pause: 0,
                    priority: 95,
                    rebuild: false});
                this.data.creeps.push(name);
    
            }
        }
    }

    private getMinerBody(): BodyPartConstant[] {
        const out = new Array<BodyPartConstant>();
        const baseParts = [WORK,MOVE];
        const minPart = [WORK,CARRY,MOVE];
        const energyAvailable = this.room.energyCapacityAvailable;
        if(energyAvailable === 300){
            return [WORK,WORK,CARRY,MOVE];
        } else if(energyAvailable === 550) {
            return [WORK,WORK,WORK,WORK,WORK,MOVE];
        } else if( energyAvailable >= 800 && energyAvailable < 5600){
            return [WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE];
        } else {
            const sources = this.room.find(FIND_SOURCES);
            if(sources.length === 2){
                const path = PathFinder.search(sources[0].pos,sources[1].pos);
                const CarryParts = 8;
                const WorkParts = Math.ceil(((sources[0].energyCapacity ) /  (300 -path.path.length ))) +2;
                const MoveParts = CarryParts + WorkParts;
                const BodyCost = CarryParts *50 + WorkParts * 100 + MoveParts * 50;
                console.log("FOr Room: " + this.room.name + " calculated BodyCost of: " + BodyCost);
                if(BodyCost <= energyAvailable){
                    return out.concat(new Array(WorkParts).fill(WORK)).concat(new Array(CarryParts).fill(CARRY)).concat(new Array(MoveParts).fill(MOVE));
                } else {
                    return [WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE]; 
                }
            }
        }
        return out;
    }

    public getBuildingList(): BuildEntry[] {
        const out = super.getBuildingList();
        if(this.room.controller != null){
            if(this.room.controller.my){
                if(this.room.storage != null){
                    const sources = this.room.find(FIND_SOURCES);
                    const baseOp = this.manager.getEntryByName<InitialRoomOperation>(this.data.parent);
                    if(baseOp != null){
                        const roomPlanner = baseOp.getRoomPlannerOperation();
                        if(sources.length >= 0){
                            for(const s of sources){
                                const path = roomPlanner.getPath(this.room.storage.pos,{pos: s.pos, range: 1});
                                if(path.path.length > 0){
                                    for(let i =1; i<= path.path.length-1; i++){
                                        out.push({x: path.path[i].x,y: path.path[i].y, type: STRUCTURE_ROAD});
                                    }
                                    
                                    if(this.room.controller.level >= 7 ){
                                        const entry = this.getLinkPosFromPath(path);
                                        if(entry != null){
                                            out.push(entry);
                                        }
                                    } else {
                                        // Place Container on the last element of the Path (right at the source)
                                        out.push({x: path.path[path.path.length-1].x, y:path.path[path.path.length-1].y, type: STRUCTURE_CONTAINER});
                                    }
                                }
                                roomPlanner.updateBuildingCostMatrix(out);
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


}