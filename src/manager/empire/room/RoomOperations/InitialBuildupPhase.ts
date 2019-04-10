import { RoomManager } from "../RoomManager";
import { InitialBuildUpPhaseData } from "./InitialBuildUpPhaseData";
import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class InitialBuildUpPhase extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);

        this.data = new InitialBuildUpPhaseData(manager.room.name);
        this.roomName = this.manager.room.name;
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */
    public firstRun(){
        // TODO
        if(this.data.firstRun === true) {
            if(Game.rooms[this.roomName] !== undefined ){
                // SPAWN CREEPS HERE 
                
            }
        }




        this.data.firstRun = false;
    }


    public init() {
        // TODO
    }
    public run() {
        // TODO
    }

    public destroy() {
        // TODO
    }

    public lastRun() {
        // TODO
    }

}