import { SupplyStorage } from "./SupplyStorage";

export class KillSelf extends SupplyStorage {
    public static run(creep: Creep): void {
        super.run(creep);
        if(creep.carry.energy === 0){
            creep.suicide();
        }
    }

    public static runCondition(creep: Creep): boolean {
        if( creep.ticksToLive != null && creep.ticksToLive <= 10 ){
            if(creep.carry.energy > 0  && creep.room.storage != null ){
                return true;
            }
        }
        return false;
    }

}