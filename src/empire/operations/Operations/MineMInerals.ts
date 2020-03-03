import { OperationsManager } from "empire/OperationsManager";
import { InitialRoomOperation } from "./InitialBuildUpPhase/InitRoomOperation";

import { OPERATION, OperationMemory } from "utils/constants";
import { RoomOperation, RoomOperationProto } from "./RoomOperation";




export class OperationMineMinerals extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.MINE_MINERALS;
    }

    public run() {
        super.run()
        this.enqueueCreeps();

    }

    private getActiveMinerals(): Mineral[] {
        return this.room.find(FIND_MINERALS).filter( m => m.mineralAmount > 0);
    }

    private setCreepsLength(): void {
        this.data.maxCreeps=0;
        if(this.room.controller != null){
            if(this.room.controller.level >= 6){
                const minerals = this.getActiveMinerals();
                if(minerals.length > 0){
                    const extractor = this.room.find(FIND_STRUCTURES).filter( str => str.structureType === STRUCTURE_EXTRACTOR).pop();
                    if(extractor != null){
                        const container =  extractor.pos.findInRange(FIND_STRUCTURES,1).filter(str => str.structureType === STRUCTURE_CONTAINER).pop();
                        if(container != null){
                            this.data.maxCreeps = 1;
                        }
                    }
                } else {
                    const min = this.room.find(FIND_MINERALS).pop();
                    if (min != null){
                        if(min.ticksToRegeneration > 0){
                            this.pause = min.ticksToRegeneration;
                        }
                    }
                }
            }
        }

    }

    private enqueueCreeps(): void {
        this.validateCreeps();
        this.setCreepsLength();
        if(this.data.maxCreeps === 1){
            if(this.data.creeps.length < this.data.maxCreeps ){
                const extractor = this.room.find(FIND_STRUCTURES).filter( str => str.structureType === STRUCTURE_EXTRACTOR);
                for( const m of extractor){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: this.room.name,
                        memory: {role: "MineralMiner", extractorId: m.id, op: this.name},
                        pause: 0,
                        priority: 620,
                        rebuild: false});
                    this.data.creeps.push(name);
        
                }

            }
        }
    }

    public getBuildingList(): BuildEntry[] {
        const out = super.getBuildingList();
        if(this.room.controller != null){
            if(this.room.controller.my){
                if(this.room.storage != null){
                    const minerals = this.room.find(FIND_MINERALS);
                    const m = minerals.pop();
                    const baseOp = this.manager.getEntryByName<InitialRoomOperation>(this.data.parent);
                    if(m != null && baseOp != null){
                        const roomPlanner = baseOp.getRoomPlannerOperation();
                        const path = roomPlanner.getPath(this.room.storage.pos,{pos: m.pos, range: 1});
                        if(path.path.length > 0){
                            for(let i =1; i<= path.path.length-1; i++){
                                out.push({x: path.path[i].x,y: path.path[i].y, type: STRUCTURE_ROAD});
                            }
                            // Place Container on the last element of the Path (right at the source)
                            out.push({x: path.path[path.path.length-1].x, y:path.path[path.path.length-1].y, type: STRUCTURE_CONTAINER});
                            out.push({x: m.pos.x, y: m.pos.y, type: STRUCTURE_EXTRACTOR});
                            roomPlanner.updateBuildingCostMatrix(out);
                        }
                    }
                }
            }
        }
        return out;
    }
}