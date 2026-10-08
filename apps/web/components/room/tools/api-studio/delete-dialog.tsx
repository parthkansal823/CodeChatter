"use client";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { deleteNode, findItem, requestsIn } from "./model";
import { useStudio } from "./studio-context";

export function DeleteDialog() {
  const { dialog, openDialog, tree, doc } = useStudio();
  const item = dialog?.kind === "delete" ? findItem(tree, dialog.id) : null;
  const inside = item?.kind === "folder" ? requestsIn(item.children).length : 0;

  return (
    <AlertDialog open={item !== null} onOpenChange={(open) => !open && openDialog(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {item?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {item?.kind === "folder"
              ? `This also deletes the ${inside} ${inside === 1 ? "request" : "requests"} inside it, for everyone in the room.`
              : "It's removed from the collection for everyone in the room."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            variant="destructive"
            onClick={() => {
              if (item) deleteNode(doc, item.id);
              openDialog(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
