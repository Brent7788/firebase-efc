import firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";
import "firebase/storage";
import DbSet from "./DbSet";
import AbstractEntity from "./entities/AbstractEntity";
import EmulatorConfig from "./entities/EmulatorConfig";
import DecoratorTool from "./tools/DecoratorTool";
import Condition from "./tools/Condition";
import StorageFile from "./entities/StorageFile";
import UploadTask = firebase.storage.UploadTask;

let canConfigEmulator = true;

export default class DbContext {

    private readonly db;
    public auth;
    private batch;
    private storageRef;
    private dbSetFieldNames: string[] = [];
    private longRunningThread = false;
    private readonly addPagination: boolean;
    private entitySetCount = 0;

    public writeError = false;

    constructor(addPagination = false, emulatorConfig: EmulatorConfig | undefined = undefined) {
        this.addPagination = addPagination;

        if (emulatorConfig && canConfigEmulator) {
            this.setupFirebaseEmulator(emulatorConfig);
        }

        this.db = firebase.firestore();
        this.batch = this.db.batch();
        this.auth = firebase.auth();
        this.storageRef = firebase.storage().ref();
    }

    private setupFirebaseEmulator(emulatorConfig: EmulatorConfig): void {
        if (emulatorConfig.firestorePort) {
            firebase.firestore().useEmulator(emulatorConfig.localhost, emulatorConfig.firestorePort);
        }

        if (emulatorConfig.authPort) {
            firebase.auth().useEmulator(`http://${emulatorConfig.localhost}:${emulatorConfig.authPort}`);
        }

        canConfigEmulator = false;
    }

    protected initializeDbFireStore(types: (new () => any)[]): void {
        if (types) {
            for (const type of types) {
                let entity = new type();
                const dbSetFieldName = this.lowercaseFirstLetter(entity.constructor.name);
                (<any>this)[dbSetFieldName] = new DbSet(type, entity, this.db, this.batch);
                this.dbSetFieldNames.push(dbSetFieldName);
            }
        }
    }

    public async set<T extends AbstractEntity>(entity: T | undefined) {

        this.validateEntityBeforeWrite(entity);

        await this.prepareFileForUpload(entity);

        const entityName = (<T>entity).constructor.name;

        if (this.addPagination) {
            this.entitySetCount++;
            (<T>entity).fieldOrderNumber = await this.getLastFieldOrderNumber(entityName);
        }

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).id);

        this.batch.set(ref, (<T>entity).asObject());
    }

    public uploadFile(file: StorageFile) {

        if (typeof file.rowData === "string")
            return this.storageRef.child(file.fullPath()).putString(file.rowData, "data_url");

        return this.storageRef.child(file.fullPath()).put(file.rowData);
    }

    private update<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).id);

        this.batch.update(ref, (<T>entity).asObject());
    }

    public delete<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).id);

        this.batch.delete(ref);
    }

    //TODO There is a problem with long running code that is going to be updated
    //     It does not update
    public handleLongRunningCode(running: () => Promise<void>): void {
        this.longRunningThread = true;

        running().then(value => {
            console.log('AM I DONE', value);
            this.longRunningThread = false;
        }).catch(error => {
            this.writeError = true;
            this.longRunningThread = false;
            console.error(error);
        })
    }

    //TODO Use a tracking system: https://docs.microsoft.com/en-us/ef/core/querying/tracking
    public async saveChangesAsync() {

        try {
            if (this.writeError) {
                console.log("Unable to save changes. There was an error on the DB context.")
                return;
            }

            const dbSets = this.getDbSets().filter(dbSet => dbSet);

            if (dbSets.length === 0)
                throw new Error("There is no entities to save");

            this.updateObservableEntities(dbSets);

            return this.batch.commit();
        } catch (error) {
            throw new Error(error.message)
        } finally {
            this.batch = this.db.batch();
            this.entitySetCount = 0;
        }
    }

    private getDbSets(): DbSet<any>[] {
        return this.dbSetFieldNames.map(dbSetFieldName => <DbSet<any>>(<any>this)[dbSetFieldName]);
    }

    private updateObservableEntities(dbSets: DbSet<any>[]): void {
        const entitiesToUpdate = dbSets
            .map(dbSet => dbSet.observableEntities.filter(o => o.haveEntityChanged))
            .flat();

        for (const entitiesToUpdateElement of entitiesToUpdate) {
            this.update(entitiesToUpdateElement.entity);
        }
    }

    private validateEntityBeforeWrite<T extends AbstractEntity>(entity: T | undefined) {
        if (!entity) {
            this.writeError = true;
            //TODO Improve error message
            throw new Error(`Please provide entity to write`);
        }

        if (!entity.id) {
            this.writeError = true;
            throw new Error(`Entity(${(<T>entity).constructor.name}) doesn't have unique identifier(id)`);
        }
    }

    private lowercaseFirstLetter(str: any): string {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }

    public async getLastFieldOrderNumber(entityName: string): Promise<number> {
        try {
            const collectionReference = this.db.collection(entityName);
            const querySnapshot = await collectionReference
                .orderBy("fieldOrderNumber")
                .limitToLast(1)
                .get();

            if (this.entitySetCount > 1 && querySnapshot.empty) {
                return this.entitySetCount;
            }

            if (querySnapshot.empty) {
                return 1;
            }

            const entity = querySnapshot.docs[0].data();

            if (entity.fieldOrderNumber === undefined ||
                entity.fieldOrderNumber === null ||
                isNaN(entity.fieldOrderNumber)) {

                throw new Error(`Entity with id: ${entity.id} field order number is undefined, null or NaN`);
            }

            if (this.entitySetCount > 1) {
                return ++entity.fieldOrderNumber + (this.entitySetCount - 1);
            }

            return ++entity.fieldOrderNumber;
        } catch (error) {
            this.writeError = true;
            console.error("Unable to process pagination", error);
            throw new Error(`Unable to process pagination ${error}`);
        }
    }

    private async prepareFileForUpload(entity: any) {
        const entityKeys = Object.keys(entity);

        for (const entityKey of entityKeys) {
            if (entity[entityKey] && typeof entity[entityKey] === "object") {
                await this.prepareFileForUpload(entity[entityKey]);
            }
        }

        await this.searchFileToUpload(entity);
    }

    private async searchFileToUpload(entity: any) {
        const fileValues = DecoratorTool.getMyPropertyDecoratorValues(entity.constructor, "FileField");

        for (const fileValue of fileValues) {
            const rawFile = entity[fileValue];

            if (Condition.isNotUndefined(rawFile) && Condition.isNotNull(rawFile)) {

                if (!Array.isArray(rawFile)) {
                    const file = (<StorageFile>rawFile);
                    const task = this.uploadFile(file);
                    file.url = await this.uploadFileTask(task);
                    continue;
                }

                //TODO I haven't tested this yet
                const files = (<StorageFile[]>rawFile);
                const urlPromises = new Array<Promise<string>>();

                files.forEach((file) => {
                    if (Condition.isNotUndefined(file) && Condition.isNotNull(file)) {
                        const task = this.uploadFile(file);

                        urlPromises.push(this.uploadFileTask(task));
                    }
                });

                const urls = await Promise.all(urlPromises);

                for (let i = 0; i < urls.length; i++) {
                    files[i].url = urls[i];
                }
            }
        }
    }

    private async uploadFileTask(task: UploadTask) {
        return new Promise<string>((resolve, reject) => {
            task.on("state_changed",
                () => {
                },
                (error) => {
                    reject(`Unable to save file. ${error.message}`)
                },
                () => {
                    task.snapshot.ref.getDownloadURL()
                        .then(url => resolve(url))
                        .catch(error => reject(error.message));
                });
        });
    }
}