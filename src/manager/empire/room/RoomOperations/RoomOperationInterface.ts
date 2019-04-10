import { RoomOperationMemoryInterface } from "./RoomOperationMemoryInterface";

/**
 * Implementing behavior of a RoomManager. Phases can start and End and will get removed
 * the RoomManager end. Rooms go through different Phases like InitialBuildup, postStorage, PostGCL8, 
 * Defense, Boost etc. Multiple Phases can be active at the same time. 
 */
export interface RoomOperationInterface extends RoomOperationMemoryInterface {
    name: string;
    data: any;
    roomName: string;
    type: string;
    priority: number;
    pause: number;
    firstRun: boolean;
    lastRun: boolean;



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
    onfirstRun(): void;
    /**
     * Logic Executed when Operation Runs the last Time. Destroying the Operation and potentially spawning a new Operation in the Manager ownning this Operation.
     */
    onlastRun(): void;
    /**
     * Logic executed at the End of each Tick
     */
    destroy(): void;
}