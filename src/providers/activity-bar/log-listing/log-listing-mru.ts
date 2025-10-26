import { ExtensionContext } from "vscode";
import { ListingMRU } from "../../../core/listing-mru";

const kLogMruKey = "inspect_ai.log-listing-mru";

export class LogListingMRU extends ListingMRU {
  constructor(context_: ExtensionContext) {
    super(kLogMruKey, context_);
  }
}
