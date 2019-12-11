import { OperationsManager } from "empire/OperationsManager";
import { SpawnEntryMemory } from "empire/spawn/SpawnEntry";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class RoomLogisticsOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "RoomLogisticsOperation";
    }

    public run() {
        super.run();
        const r: Room = this.room;
        let anchor: {x:number, y:number}  | null= null;
        if(this.room.memory.base != null){
            if(this.room.memory.base.anchor != null){
                anchor = this.room.memory.base.anchor;
            }
        }
        if(this.data.logstics == null){
            this.data.logistics = 1;
        }





        // Validate creeps:
        this.validateCreeps();
        if(anchor != null){
            if( r != null && r.storage != null){
                if(this.data.logistics > this.data.creeps.length) {
                    const body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE] as BodyPartConstant[];
                   this.enqueCreep({
                        room: r.name,
                        toPos: anchor,
                        body: body,
                        memory: {role: "Logistic", op: this.name},
                        pause: 0,
                        priority: 100,
                        rebuild: false});
                }
    
            }
        }

    }

    private enqueCreep(entry: SpawnEntryMemory): void {
        const body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE] as BodyPartConstant[];
        const name = this.manager.empire.spawnMgr.enque(entry);
            this.data.creeps.push(name);
    }


}