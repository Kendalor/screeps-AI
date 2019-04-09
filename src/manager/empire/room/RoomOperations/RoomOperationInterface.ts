import { RoomManager } from "../RoomManager";
import { RoomOperationDataInterface } from "./RoomOperationDataInterface";

/**
 * Implementing behavior of a RoomManager. Phases can start and End and will get removed
 * the RoomManager end. Rooms go through different Phases like InitialBuildup, postStorage, PostGCL8, 
 * Defense, Boost etc. Multiple Phases can be active at the same time. 
 */
export interface RoomOperationInterface {
    name: string;
    data: RoomOperationDataInterface;
    roomName: string;

    /**
     * Logic executed at the beginning of EACH Tick
     */
    init(): void;
    /**
     * Logic Executed during Each Tick
     */
    run(): void;
    /**
     * Logic Executed when Operation Runs the first time, setting up Spawns etc.
     */
    firstRun(): void;
    /**
     * Logic Executed when Operation Runs the last Time. Destroying the Operation and potentially spawning a new Operation in the Manager ownning this Operation.
     */
    lastRun(): void;
    /**
     * Logic executed at the End of each Tick
     */
    destroy(): void;
}