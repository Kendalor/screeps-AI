import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation } from "./FlagOperation";
import { OperationMemory } from "./OperationMemory";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ColonizeOperation extends FlagOperation{
    public numCreeps: number = 6;

    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "ColonizeOperation";
    }



    public run() {
        super.run();
        this.validateCreeps();
        if(this.data.creeps.length < this.numCreeps){
            const roomName = this.findnearestRoom();
            if(roomName != null){
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: undefined,
                        memory: {role: "Colonize", flag: this.flag.name},
                        pause: 0,
                        priority: 40,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            } else {
                this.lastRun = true;
            }
        }



        const r = this.flag.room;

        if( r != null){
            if(r.controller != null){
                if(r.controller.my ){
                    const structs = r.find(FIND_HOSTILE_STRUCTURES);
                    if( structs.length > 0){
                        for(const i of structs){
                            i.destroy();
                        }
                    }
                    if(this.flag.pos.lookFor(LOOK_CONSTRUCTION_SITES).length === 0){
                        this.flag.pos.createConstructionSite(STRUCTURE_SPAWN);
                    }
                }
            }
            if(r.storage != null){
                this.manager.enque({type: "InitialRoomOperation", data: {roomName: this.flag.pos.roomName}, priority: 100,pause: 1, lastRun: false});
                for(const creep of this.data.creeps){
                    if(Game.creeps[creep] != null){
                        Game.creeps[creep].memory.role = "Maintenance";
                    } else {
                        this.manager.empire.spawnMgr.dequeueByName(creep);
                    }
                }
                this.flag.remove();
            }
        }
    }


}