import { CreepManager } from "empire/CreepManager";
import { OperationsManager } from "./OperationsManager";
import { SpawnManager } from "./SpawnManager";

export class EmpireManager  {
    public opMgr: OperationsManager;
    public creepMgr: CreepManager;
    public spawnMgr: SpawnManager;

    constructor(){
        if(Memory.empire == null){
            Memory.empire= {};
        }
       this.opMgr = new OperationsManager(this);
       this.creepMgr = new CreepManager(this);
       this.spawnMgr = new SpawnManager(this);

    }
    
    public run(): void{
        global.logger.debug("Empire Manager doing Stuff ");
        let time = Game.cpu.getUsed();
        this.spawnMgr.run();
        global.logger.info(" ----------------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.creepMgr.run();
        global.logger.info(" ----------------- CREEPMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.run();
        global.logger.info(" ----------------- OP   MANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");

        
    }


    public init(): void {
        let time = Game.cpu.getUsed();
        this.spawnMgr.init();
        global.logger.info(" INIT ----------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.init();
        global.logger.info(" INIT ----------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        if(Object.keys(this.opMgr.operations).length === 0 ){
            global.logger.warn("No Operations Found");
            if(Object.keys(Game.rooms).length === 1){
                global.logger.warn("Only one Room Object found");
                if(Object.keys(Game.creeps).length === 0){
                    global.logger.warn("No Creeps Found");
                    for(const key in Game.rooms){
                        global.logger.info("Added InitialRoomOperation for Room: " + key);
                        this.opMgr.enque({type: "InitialRoomOperation", data: {roomName: Game.rooms[key].name}, priority: 100,pause: 1, lastRun: false});
                    }
                }
            }
        }
    }

    public destroy(): void {
        let time = Game.cpu.getUsed();
        this.spawnMgr.destroy();
        global.logger.info(" DESTROY ------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.destroy();
        global.logger.info(" DESTORY  ------ SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
    }
}
