import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation } from "./FlagOperation";
import { OperationMemory } from "./OperationMemory";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ColonizeOperation extends FlagOperation{
    public numCreeps: number = 6;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "ColonizeOperation";
    }



    public run() {
        console.log("ColonizeOP:");
        super.run();
        this.validateCreeps();
        if(this.data.creeps.length < this.numCreeps){
            const roomName = this.findnearestRoom();
            if(roomName != null){
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: undefined,
                        memory: {role: "Colonize", flag: this.flag.name, op: this.name},
                        pause: 0,
                        priority: 40,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            } else {
                this.removeSelf();
            }
        }


        if(this.flag != null){
            const r = this.flag.room;
            if( r != null){
                if(r.controller != null){
                    if(r.controller.my ){
                        if(this.data.initialCleanup !== true){
                            const structs = r.find(FIND_STRUCTURES);
                            if( structs.length > 0){
                                for(const i of structs){
                                    i.destroy();
                                }
                                this.data.initialCleanup = true;
                            }  
                        }
                        if(this.data.roomPlanner == null){
                            this.data.roomPlanner = this.manager.enque({type: "RoomPlannerOperation", data: {roomName: r.name, parent: this.name}, priority: 20, pause: 1});
                        }
                    } else {
                        const flags = r.find(FIND_FLAGS).filter(f => f.color === COLOR_BLUE && f.secondaryColor === COLOR_BLUE);
                        if(flags.length === 0){
                            this.flag.pos.createFlag(undefined,COLOR_BLUE,COLOR_BLUE);                        
                        }
                    }
                }
                if(r.storage != null){
                    this.manager.enque({type: "InitialRoomOperation", data: {roomName: this.flag.pos.roomName}, priority: 100,pause: 1});
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
        } else {
            this.removeSelf();
        }
        

    }


}