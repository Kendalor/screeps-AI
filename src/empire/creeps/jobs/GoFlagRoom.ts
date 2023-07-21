import { Job } from "./Job";

export class GoFlagRoom extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target = Game.flags[creep.memory.targetId];
        //console.log(" Creep: " + creep.name + " in Room: "+ creep.room.name);
        if(target != null){
            const targetPos = Game.flags[creep.memory.targetId].pos;
            const room = target.room;
            if(room != null){
                const portal = target.pos.findInRange(FIND_STRUCTURES,0).filter( str => str.structureType === STRUCTURE_PORTAL).pop() as StructurePortal | undefined;
                if( portal != null){
                    const dest = portal.destination as {shard: string, room: string};
                    if(dest.shard != null){
                        // SEND CREEP MEMORY TO shard
                        const data = JSON.parse(InterShardMemory.getLocal() || "{}");
                        if(data.creeps == null){
                            data.creeps = {};
                        }
                        data.creeps[creep.name]= creep.memory;
                        InterShardMemory.setLocal(JSON.stringify(data));
                    }
                } else {
                    if(creep.pos.inRangeTo(targetPos,3)){
                        creep.memory.targetRoom = room.name;
                        delete creep.memory.flag;
                        this.cancel(creep);
                    }
                }
            }
            if(creep.pos.inRangeTo(targetPos,15)){
                this.cancel(creep);
            } else {
                creep.travelTo(targetPos,{range: 15, useFindRoute: true});
            }
        } else {
            this.cancel(creep);
        }

    }


    public static runCondition(creep: Creep): boolean {
        if(creep.memory.flag != null){
            const flag = Game.flags[creep.memory.flag];
            //console.log("Creep Runcondition");
            if(flag != null && creep.pos.roomName !== flag.pos.roomName){
                return true;
            }
        }
        return false;

    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.flag != null){
            const flag = Game.flags[creep.memory.flag];
            if(flag.pos.roomName !== creep.pos.roomName){
                return creep.memory.flag;
            }
        }
        return null;
    }
}