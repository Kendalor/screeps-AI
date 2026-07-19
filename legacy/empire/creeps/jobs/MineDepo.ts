import { Job } from "./Job";

export class MineDepo extends Job {

    public static run(creep: Creep): void {
        console.log("Run mine Deposit ");
        const deposit = Game.getObjectById<Deposit>(creep.memory.targetId);
        if(deposit != null){
            console.log("DEpo != null");
            if(creep.pos.inRangeTo(deposit,1)){
                console.log("Depo in range" + creep.harvest(deposit));
            }else{
                creep.travelTo(deposit);
            }
        }else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        const deposit = creep.room.find(FIND_DEPOSITS).pop();
        if(deposit != null){
            return deposit.id;
        }
        return null;
    }
}