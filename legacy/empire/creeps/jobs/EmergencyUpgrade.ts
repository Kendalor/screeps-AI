import { Upgrade} from "./Upgrade";

export class EmergencyUpgrade extends Upgrade {


    public static runCondition(creep: Creep): boolean {
        if( creep.carry.energy > 0){
            if(creep.room.controller != null ){
                if(creep.room.controller.level === 1 ){
                    return true;
                } else if(creep.room.controller.ticksToDowngrade != null && creep.room.controller!.ticksToDowngrade < 5000 ){
                    return true;
                }
            }
        }
        return false;
    }


}