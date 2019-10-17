import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";



export class MinerOperation extends RoomOperation{
    

    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "MinerOperation";
    }

    public run() {
        super.run()

        const r: Room = this.room;
        if(r!= null ){
            // Validate creeps:
            this.validateCreeps();

            if(this.data.creeps.length < 2 ){
                const sources: Source[] = r.find(FIND_SOURCES);
                for(const s of sources){
                    console.log("enqued Creep for: " + s.id);
                    const name = this.manager.empire.spawnMgr.enque({
                        room: s.room.name,
                        memory: {role: "Miner", sourceId: s.id},
                        pause: 0,
                        priority: 90,
                        rebuild: true});
                    this.data.creeps.push(name);
                }

            }

        }
    }

}