import { CreepManager } from "empire/CreepManager";
import { EmpireStats } from "./EmpireStats";
import { OperationsManager } from "./OperationsManager";
import { SpawnManager } from "./SpawnManager";

export class EmpireManager  {
    public opMgr: OperationsManager;
    public creepMgr: CreepManager;
    public spawnMgr: SpawnManager;
    public stats: EmpireStats;

    constructor(){
        if(Memory.empire == null){
            Memory.empire= {};
        }
        this.stats = new EmpireStats(this);
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
        this.stats.run();
        
    }


    public init(): void {
        this.stats.init();
        let time = Game.cpu.getUsed();
        this.spawnMgr.init();
        global.logger.info(" INIT ----------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.init();
        global.logger.info(" INIT ----------- OP  MANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
    }

    public destroy(): void {
        let time = Game.cpu.getUsed();
        this.spawnMgr.destroy();
        global.logger.info(" DESTROY ------- SPAWNMANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.opMgr.destroy();
        global.logger.info(" DESTORY  ------ OP   MANAGER CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
        time = Game.cpu.getUsed();
        this.stats.destroy();
    }
}
