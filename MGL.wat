(module

  (import "memory" "main" (memory 0))
  
  (func $ensure (param $ptr<out> i32) (param $sizeof<data> i32)
    (local $addpages i32)
    (set_local $addpages (i32.sub
      (current_memory)
      (i32.div_u
        (i32.add (get_local $ptr<out>) (get_local $sizeof<data>))
        (i32.const 65536)
      )
    ))
    (if (i32.gt_s (get_local $addpages) (i32.const 0)) (then
      (drop (grow_memory (get_local $addpages)))
    ))
  )
  
  (func $copy (param $ptr<out> i32) (param $ptr<in> i32) (param $sizeof<data> i32)
    block
      loop
        (br_if 1 (i32.eqz (get_local $sizeof<data>)))
        (i32.store8 (get_local $ptr<out>) (i32.load8_u (get_local $ptr<in>)))
        (set_local $ptr<out>     (i32.add (get_local $ptr<out>)     (i32.const 1)))
        (set_local $ptr<in>      (i32.add (get_local $ptr<in>)      (i32.const 1)))
        (set_local $sizeof<data> (i32.sub (get_local $sizeof<data>) (i32.const 1)))
        br 0
      end
    end
  )
  
  (func (export "decode")
    (param $ptr<in> i32)
    (param $end<in> i32)
    (param $ptr<out> i32)
    (result i32)
    
    (local $b i32)
    (local $offset i32)
    (local $length i32)
    (local $reps i32)
    (local $state i32)
    (local $inc i32)
    (local $rep_length i32)
    (local $copy_length i32)
    
    block $break
      loop $continue
        ;; if (in_ptr > end_ptr) break;
        (br_if 1 (i32.ge_u (get_local $ptr<in>) (get_local $end<in>)))
        
        ;; b = *in_ptr++;
        (set_local $b (i32.load8_u (get_local $ptr<in>)))
        (set_local $ptr<in> (i32.add (get_local $ptr<in>) (i32.const 1)))
        
        block $do_reps:
        
        block $E_F:
        block $C_D:
        block $8_B:
        block $7:
        block $6:
        block $5:
        block $4:
        block $1_3:
        block $0:

        (i32.shr_u (get_local $b) (i32.const 4))
        br_table
          $0:   $1_3: $1_3: $1_3:
          $4:   $5:   $6:   $7:
          $8_B: $8_B: $8_B: $8_B:
          $C_D: $C_D: $E_F: $E_F:

        end $0:
          ;; if (b === 0) break;
          (br_if $break (i32.eqz (get_local $b)))
          ;; fall through:
        end $1_3:
          ;; length = b;
          (set_local $length (get_local $b))
          ;; if ((in_ptr + length) > end_ptr) error;
          (if (i32.gt_u (i32.add (get_local $ptr<in>) (get_local $length)) (get_local $end<in>)) (then
            ;; not enough input
            unreachable
          ))
          (call $ensure (get_local $ptr<out>) (get_local $length))
          (call $copy (get_local $ptr<out>) (get_local $ptr<in>) (get_local $length))
          (set_local $ptr<in>  (i32.add (get_local $ptr<in>)  (get_local $length)))
          (set_local $ptr<out> (i32.add (get_local $ptr<out>) (get_local $length)))
          br $continue
        end $4:
          ;; length = 3 + (b & 0xF);
          (set_local $length (i32.add (i32.const 3) (i32.and (get_local $b) (i32.const 0xF))))
          (call $ensure (get_local $ptr<out>) (get_local $length))
          (set_local $state (i32.load8_u (i32.sub (get_local $ptr<out>) (i32.const 1))))
          (set_local $inc (i32.sub
            (get_local $state)
            (i32.load8_u (i32.sub (get_local $ptr<out>) (i32.const 2)))
          ))
          loop
            (i32.store8 (get_local $ptr<out>) (tee_local $state (i32.add (get_local $state) (get_local $inc))))
            (set_local $ptr<out> (i32.add (get_local $ptr<out>) (i32.const 1)))
            (br_if 0 (tee_local $length (i32.sub (get_local $length) (i32.const 1))))
          end
          br $continue
        end $5:
          ;; length = 2 + (b & 0xF);
          (set_local $length (i32.shl (i32.add (i32.const 2) (i32.and (get_local $b) (i32.const 0xF))) (i32.const 1)))
          (call $ensure (get_local $ptr<out>) (get_local $length))
          (set_local $state (i32.load16_u align=1 (i32.sub (get_local $ptr<out>) (i32.const 2))))
          (set_local $inc (i32.sub
            (get_local $state)
            (i32.load16_u align=1 (i32.sub (get_local $ptr<out>) (i32.const 4)))
          ))
          loop
            (i32.store16 align=1 (get_local $ptr<out>) (tee_local $state (i32.add (get_local $state) (get_local $inc))))
            (set_local $ptr<out> (i32.add (get_local $ptr<out>) (i32.const 2)))
            (br_if 0 (tee_local $length (i32.sub (get_local $length) (i32.const 2))))
          end
          br $continue
        end $6:
          (set_local $offset (i32.const 1))
          (set_local $length (i32.const 1))
          (set_local $reps (i32.add
            (i32.const 3)
            (i32.and (get_local $b) (i32.const 0xF))
          ))
          br $do_reps:
        end $7:
          (set_local $offset (i32.const 2))
          (set_local $length (i32.const 2))
          (set_local $reps (i32.add
            (i32.const 2)
            (i32.and (get_local $b) (i32.const 0xF))
          ))
          br $do_reps:
        end $8_B:
          (set_local $offset (i32.add
            (i32.const 3)
            (i32.and (get_local $b) (i32.const 0x3F))
          ))
          (set_local $length (i32.const 3))
          (set_local $reps (i32.const 1))
          br $do_reps:
        end $C_D:
          (set_local $offset (i32.add
            (i32.const 3)
            (i32.or
              (i32.shl (i32.and (get_local $b) (i32.const 0x3)) (i32.const 8))
              (i32.load8_u (get_local $ptr<in>))
            )
          ))
          (set_local $ptr<in> (i32.add (get_local $ptr<in>) (i32.const 1)))
          (set_local $length (i32.add
            (i32.const 4)
            (i32.and
              (i32.shr_u (get_local $b) (i32.const 2))
              (i32.const 7)
            )
          ))
          (set_local $reps (i32.const 1))
          br $do_reps:
        end $E_F:
          (set_local $offset (i32.add
            (i32.const 3)
            (i32.or
              (i32.shl (i32.and (get_local $b) (i32.const 0x1F)) (i32.const 8))
              (i32.load8_u (get_local $ptr<in>))
            )
          ))
          (set_local $length (i32.add
            (i32.const 5)
            (i32.load8_u offset=1 (get_local $ptr<in>))
          ))
          (set_local $ptr<in> (i32.add (get_local $ptr<in>) (i32.const 2)))
          (set_local $reps (i32.const 1))
          ;; fall through:
          
        end $do_reps:
          (call $ensure (get_local $ptr<out>) (i32.mul (get_local $reps) (get_local $length)))
          (if (i32.gt_u (get_local $length) (get_local $offset)) (then
            (set_local $offset (i32.sub (get_local $ptr<out>) (get_local $offset)))
            (set_local $copy_length (i32.sub (get_local $ptr<out>) (get_local $offset)))
            loop
              (set_local $rep_length (get_local $length))
              loop
                (call $copy (get_local $ptr<out>) (get_local $offset) (get_local $copy_length))
                (set_local $rep_length (i32.sub (get_local $rep_length) (get_local $copy_length)))
                (br_if 0 (i32.gt_u (get_local $rep_length) (get_local $copy_length)))
              end
              (if (get_local $rep_length) (then
                (call $copy (get_local $ptr<out>) (get_local $offset) (get_local $rep_length))
                (set_local $ptr<out> (i32.add (get_local $ptr<out>) (get_local $rep_length)))
              ))
              (br_if 0 (tee_local $reps (i32.sub (get_local $reps) (i32.const 1))))
            end
          )
          (else
            (set_local $offset (i32.sub (get_local $ptr<out>) (get_local $offset)))
            loop
              (call $copy (get_local $ptr<out>) (get_local $offset) (get_local $length))
              (set_local $ptr<out> (i32.add (get_local $ptr<out>) (get_local $length)))
              (br_if 0 (tee_local $reps (i32.sub (get_local $reps) (i32.const 1))))
            end
          ))
          br $continue
      end
    end
    (return (get_local $ptr<out>))
  )

)
